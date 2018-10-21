/*
 * NodeJS Seedlink Proxy
 *
 * Wrapper class for a single Seedlink proxy
 *
 * Copyright: ORFEUS Data Center, 2018
 * Author: Mathijs Koymans
 * Licensed under MIT
 *
 */

'use strict'

// Native lib
const network = require('net')

// Library for reading mSEED records
const MSeedRecord = require('libmseedjs')

const SeedlinkProxy = function (options, handler) {
  /* Class SeedlinkProxy
   * Single entity of a Seedlink proxy that can connect to a
   * remote Seedlink server and broadcast unpacked data samples
   */

  // Privates
  this._connected = false

  // Copy channel options
  this.name = options.name
  this.host = options.host
  this.port = options.port
  this.commands = this.getStreamCommands(options.selectors)

  // Handler for messages
  this.handler = handler

  // Create the TCP socket
  this.seedlinkSocket = new network.Socket()

  // Attach handlers for Seedlink
  this.attachSeedlinkHandlers()
}

SeedlinkProxy.prototype.attachSeedlinkHandlers = function () {
  /* Function SeedlinkProxy.attachSeedlinkHandlers
   * Adds listeners to TCP socket callbacks
   */

  const SEEDLINK_OK = this.convertCommand('OK')
  const SL_RECORD_SIZE = 520

  var message, buffer

  // Connection refused by remote Seedlink server
  this.seedlinkSocket.on('error', (error) => {
    this.broadcast({
      'error': error
    })
  })

  // First connect: open a new empty data buffer
  this.seedlinkSocket.on('connect', () => {
    buffer = Buffer.alloc(0)
  })

  // When data is received from the Seedlink TCP socket
  this.seedlinkSocket.on('data', (data) => {
    // Communicate the handshake with Seedlink
    if (data.equals(SEEDLINK_OK) && this._commands.length) {
      return this.handshake()
    }

    // Extend the buffer with newly returned data from Seedlink
    buffer = Buffer.concat([buffer, data])

    // We have collected an 8-byte header and 512-byte body
    // which is representative of a full record that can be parsed
    while (buffer.length >= SL_RECORD_SIZE) {
      // Create a new record from the returned bytes, skip 8-bytes Seedlink header
      try {
        message = new MSeedRecord(buffer.slice(8, SL_RECORD_SIZE)).payload()
      } catch (exception) {
        message = {
          'error': 'Error unpacking mSEED record'
        }
      }

      // Broadcast the message to all connected sockets
      this.broadcast(message)

      // Slice buffer beyond the record end
      buffer = buffer.slice(SL_RECORD_SIZE)
    }
  })

  // Socket was closed, set connected to false
  this.seedlinkSocket.on('close', () => {
    this._connected = false
  })
}

SeedlinkProxy.prototype.broadcast = function (object) {
  /* Function SeedlinkProxy.broadcast
   * Broadcasts a message over osc
   */

  if (object && object.error) {
    this.handler(object)
  } else {
    this.handler(null, object)
  }
}

SeedlinkProxy.prototype.convertCommand = function (command) {
  /* Function SeedlinkProxy.convertCommand
   * Converts a string to a Seedlink command by appending CRNL
   */

  const CR = String.fromCharCode(13)
  const NL = String.fromCharCode(10)

  return Buffer.from(command + CR + NL, 'ascii')
}

SeedlinkProxy.prototype.getStreamCommands = function (selectors) {
  /* Function SeedlinkProxy.getStreamCommands
   * Returns list of commands in reverse order to write to Seedlink
   */

  var commands = new Array('END')

  // Correct Seedlink handshake
  selectors.forEach((stream) => {
    commands.push('DATA')
    commands.push('SELECT ' + stream.location + stream.channel)
    commands.push('STATION ' + stream.station + ' ' + stream.network)
  })

  // Convert to Seedlink commands
  return commands.map(this.convertCommand)
}

SeedlinkProxy.prototype.disconnect = function (cb) {
  /* Function SeedlinkProxy.disconnect
   * Gracefully disconnects from the remote Seedlink server
   */

  if (!this._connected) {
    return cb()
  }

  this._connected = false

  const SEEDLINK_BYE = this.convertCommand('BYE')

  this.seedlinkSocket.on('close', cb)

  this.seedlinkSocket.write(SEEDLINK_BYE)
  this.seedlinkSocket.destroy()
}

SeedlinkProxy.prototype.isConnected = function () {
  return this._connected
}

SeedlinkProxy.prototype.connect = function () {
  /* Function SeedlinkProxy.connect
   * Connects to the remote Seedlink server
   */

  // Do not connect twice
  if (this._connected) {
    return
  }

  this._connected = true

  // Get the list of commands (copy in memory)
  this._commands = this.commands.map(x => x)

  // Connect to the particular TCP Seedlink socket
  this.seedlinkSocket.connect(this.port, this.host, this.handshake.bind(this))
}

SeedlinkProxy.prototype.handshake = function () {
  /* Function SeedlinkProxy.handshake
   * Initiates the handshake with Seedlink
   */

  // Write command as handshake
  this.seedlinkSocket.write(this._commands.pop())
}

module.exports = SeedlinkProxy
