// Handler for messages received via IPC about new active stations
const ipc = require('node-ipc')

const fs = require('fs')
const path = require('path')
const EventEmitter = require('events')

// Station should stay active for defined amount of time
const {
  HOT_ALL_TIMEOUT,
  HOT_ALL_FILEPATH
} = require('../config.json')

ipc.config.id = 'node-seedlink-data-proxy'
ipc.config.retry = 1500
ipc.config.silent = true

// File is relative to project root, not this file
const filePath = path.resolve(__dirname, '../', HOT_ALL_FILEPATH)

function loadFromJson () {
  if (fs.existsSync(filePath)) {
    return require(filePath)
  }

  return {}
}

function storeInJson (data) {
  return Promise.fromCallback(callback => {
    fs.writeFile(filePath, JSON.stringify(data, null, '  '), callback)
  })
}

class HotStations extends EventEmitter {
  constructor () {
    super()

    // Load stations from JSON file
    this.stations = loadFromJson()

    // Bind functions/methods
    this.cleaner = this.cleaner.bind(this)
    this.onNewStation = this.onNewStation.bind(this)

    // Start IPC server
    this.initIpcServer()

    // Schedule cleaner to be run every 5 min
    setInterval(this.cleaner, 5 * 60 * 1000)
  }

  initIpcServer () {
    ipc.serve(() => {
      ipc.server.on('new-station', this.onNewStation)
    })

    ipc.server.start()
  }

  station2String (station) {
    return `${station.net}.${station.sta}.${station.loc}:${station.channels.sort().join(',')}`
  }

  string2Station (stationStr) {
    const [ net, sta, rest ] = stationStr.split('.')
    const [ loc, channels ] = rest.split(':')

    return {
      net,
      sta,
      loc,
      channels
    }
  }

  onNewStation (station) {
    const key = this.station2String(station)
    const isNewKey = !this.stations[key]

    console.log('New station', key, isNewKey)

    this.stations[key] = Date.now()

    if (isNewKey) {
      // Send event, that stations have changed
      this.emit('add', key)
    } else {
      // Update timer, so that cleaner does not remove this key
      this.stations[key] = Date.now()
    }

    storeInJson(this.stations)
  }

  getStations () {
    return Object.keys(this.stations)
  }

  cleaner () {
    const toBeDeleted = Object.keys(this.stations).filter(key => {
      const time = this.stations[key]
      if (time + HOT_ALL_TIMEOUT < Date.now()) {
        return true
      }

      return false
    })

    console.log('Cleaner running:', toBeDeleted)

    if (toBeDeleted.length) {
      toBeDeleted.forEach(keyTobeDeleted => {
        this.emit('remove', keyTobeDeleted)
        delete this.stations[keyTobeDeleted]
      })

      storeInJson(this.stations)
    }
  }

  shutdownIpcServer () {
    if (ipc && ipc.server && ipc.server.stop) {
      ipc.server.stop()
    }

    process.exit(0)
  }
}

const hotStationsInstance = new HotStations()

process.once('SIGTERM', hotStationsInstance.shutdownIpcServer)
process.once('SIGINT', hotStationsInstance.shutdownIpcServer)

module.exports = hotStationsInstance
