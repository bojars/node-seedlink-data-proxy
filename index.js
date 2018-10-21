/*
 * nodejs-seedlink-data-proxy
 *
 * Seedlink server proxy written for NodeJS. Connects to
 * multiple seedlink servers and broadcasts unpacked data samples
 * over HTML5 websockets.
 *
 * Copyright: ORFEUS Data Center, 2018
 * Author: Mathijs Koymans
 * Licensed under MIT
 *
 */

'use strict'

// Third party libs
const osc = require('node-osc')

global.Promise = require('bluebird')

// Application libs
const SeedlinkProxy = require('./lib/seedlink-proxy')
const hotAll = require('./lib/hot-all')

const __VERSION__ = '1.0.0'

const SeedlinkOsc = function (configuration, callback) {
  /* Class SeedlinkWebsocket
   * Websocket server that relays unpacked data from arbitrary
   * Seedlink server to the browser
   */

  this.configuration = configuration

  // Get process environment variables (Docker)

  // Create osc client
  this.oscClient = new osc.Client(configuration.OSC_CLIENT_HOST, configuration.OSC_CLIENT_PORT)
  this.oscServer = new osc.Server(configuration.OSC_SERVER_PORT, configuration.OSC_SERVER_HOST)

  // Create osc server listener
  this.createOscServerListener()

  // Create all channels
  this.createSeedlinkProxies()

  // Create HOT.ALL stations listeners
  this.createHotAllListeners()

  callback(configuration.__NAME__, configuration)
}

SeedlinkOsc.prototype.createOscServerListener = function () {
  this.oscServer.on('message', function (msg, rinfo) {
    if (!Array.isArray(msg) || msg.length <= 1) {
      console.error('Incorrect message received via OSC - should be array', msg)
      return
    }

    const path = msg.shift()
    const channel = msg.shift()

    if (!channel || (!this.channels[channel] && channel !== 'HOT.ALL')) {
      console.error('Could not find provided channel')
      return
    }

    const isSubscribe = path === '/subscribe'
    const isUnsubscribe = path === '/unsubscribe'

    let channelsList = []
    if (channel === 'HOT.ALL') {
      this.hotAllChannelSubscribed = isSubscribe

      channelsList = Object.keys(this.channels).reduce((acc, name) => {
        if (name.indexOf('HOT.ALL') === 0) {
          acc.push(this.channels[name])
        }

        return acc
      }, [])
    } else {
      channelsList.push(this.channels[channel])
    }

    if (isSubscribe) {
      channelsList.forEach(channel => channel.connect())
    } else if (isUnsubscribe) {
      channelsList.forEach(channel => channel.disconnect(() => {}))
    }
  }.bind(this))
}

SeedlinkOsc.prototype.createSeedlinkProxies = function () {
  /* Function SeedlinkWebsocket.createSeedlinkProxies
   * Initializes the configured seedlink proxies
   */

  this.channels = {}
  this.hotAllChannel = null
  this.hotAllChannelSubscribed = false

  this.handler = (err, result) => {
    if (err) {
      console.error(err)
      return
    }

    const { network, station, location, channel, data } = result

    const ident = `${network}_${station}_${location}_${channel}`

    this.oscClient.send(['/geo', ident, ...data])
  }

  // Read the channel configuration and create new sleeping proxies
  require('./channel-config').forEach((channel) => {
    if (channel.name !== 'HOT.ALL') {
      // As HOT.ALL is special channel, ignore it here
      this.channels[channel.name] = new SeedlinkProxy(channel, this.handler)
    } else {
      // Store hot.all channel info
      this.hotAllChannel = channel
    }
  })

  if (this.hotAllChannel) {
    // Add HOT.ALL channels, if any exist
    const stations = hotAll.getStations();
    (stations || []).forEach(stationStr => {
      const channel = this.station2channel(stationStr)

      console.log(`HOT.ALL channel created`, channel)

      this.channels[channel.name] = new SeedlinkProxy(channel, this.handler)
    })
  }

  // TODO: Create listener for added/removed seedlink channels from seismo project
  // TODO: When new network.station is received, make new channel, that start with "_HOT_ALL_" so that when stopping HOT.ALL, stop all channels that start with mentioned pattern
  // TODO: New station is added, make sure that if currently are connected to HOT.ALL, then automagically also connects new station
}

SeedlinkOsc.prototype.station2channel = function (stationStr) {
  if (!this.hotAllChannel) {
    throw new Error('Not HOT.ALL channel defined in channel-config.json')
  }

  const name = `HOT.ALL.${stationStr}`

  const station = hotAll.string2Station(stationStr)

  return { ...this.hotAllChannel,
    name,
    selectors: [{
      network: station.net,
      station: station.sta,
      channel: 'BH?', // Not taking stations channels, just listen all BH..
      location: station.loc
    }]
  }
}

SeedlinkOsc.prototype.createHotAllListeners = function () {
  if (this.hotAllChannel) {
    console.log('Adding HOT.ALL listeners')

    // This listener only makes sense if we have HOT.ALL as defined station in channel-config.json file
    hotAll.on('add', this.onHotStationAdd.bind(this))
    hotAll.on('remove', this.onHotStationRemove.bind(this))
  } else {
    console.log('No HOT.ALL channel provided, not setting listeners')
  }
}

SeedlinkOsc.prototype.onHotStationAdd = function (stationStr) {
  console.log('Station added:', stationStr)
  const channel = this.station2channel(stationStr)
  if (!this.channels[channel.name]) {
    console.log('Station added:', stationStr, 'not found in channels list, creating new')

    this.channels[channel.name] = new SeedlinkProxy(channel, this.handler)

    if (this.hotAllChannelSubscribed) {
      console.log('Station added:', stationStr, 'connecting, as HOT.ALL was listening')
      this.channels[channel.name].connect()
    }

    console.log('Station added:', stationStr, 'added successfuly')
  }
}

SeedlinkOsc.prototype.onHotStationRemove = function (stationStr) {
  console.log('Station removed:', stationStr)

  const channel = this.station2channel(stationStr)

  if (this.channels[channel.name]) {
    console.log('Station removed:', stationStr, 'channel found')

    if (this.hotAllChannelSubscribed) {
      console.log('Station removed:', stationStr, 'channel disconnect')

      this.channels[channel.name].disconnect(() => {})
    }

    // Remove from channels
    delete this.channels[channel.name]

    console.log('Station removed:', stationStr, 'channel removed')
  }
}

SeedlinkOsc.prototype.disconnectChannels = function (cb) {
  const channels = this.channels

  return Promise.resolve(Object.keys(this.channels)).each(name => {
    return Promise.fromCallback(callback => {
      const channel = channels[name]
      channel.disconnect(callback)

      console.log(`Stopping channel ${name}`)
    })
  }).then(cb)
}

// Expose the class
module.exports.server = SeedlinkOsc
module.exports.__VERSION__ = __VERSION__

let isStopping = false

function shutdown () {
  if (isStopping) {
    return
  }

  isStopping = true

  console.info('Got SIGTERM. Graceful shutdown start', new Date().toISOString())

  this.disconnectChannels(() => {
    process.exit()
  })

  setTimeout(() => {
    console.log('Forcing shutdown after 30sec')
    process.exit()
  }, 30 * 1000)
}

if (require.main === module) {
  const CONFIG = require('./config')

  // TODO: On close - this.unsubscribeAll(socket)

  // Start the microservice
  const instance = new SeedlinkOsc(CONFIG, (name, configuration) => {
    console.log(`${name} microservice has been started:\n`)
    console.log(`  OSC client host: ${configuration.OSC_CLIENT_HOST}, port: ${configuration.OSC_CLIENT_PORT}`)
    console.log(`  OSC server host: ${configuration.OSC_SERVER_HOST}, port: ${configuration.OSC_SERVER_PORT}\n`)
    console.log(`  To subscribe, send OSC message to server host & port in form: /subscribe {channel name}`)
    console.log(`  To unsubscribe, send OSC message to server host & port in form: /unsubscribe {channel name}\n`)
  })

  process.once('SIGTERM', shutdown.bind(instance))
  process.once('SIGINT', shutdown.bind(instance))
}
