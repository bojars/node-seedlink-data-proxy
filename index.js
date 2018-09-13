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

    if (!channel || !this.channels[channel]) {
      console.error('Could not find provided channel')
      return
    }

    if (path === '/subscribe') {
      this.channels[channel].connect()
    } else if (path === '/unsubscribe') {
      this.channels[channel].disconnect()
    }
  }.bind(this))
}

SeedlinkOsc.prototype.createSeedlinkProxies = function () {
  /* Function SeedlinkWebsocket.createSeedlinkProxies
   * Initializes the configured seedlink proxies
   */

  this.channels = {}

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
    this.channels[channel.name] = new SeedlinkProxy(channel, this.handler)
  })
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
  } else {
    isStopping = true
  }

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
