var osc = require('node-osc')

var connected = false
var client = new osc.Client('127.0.0.1', 9002)
client.send('/subscribe', 'HOT.ALL', function () {
  connected = true
})

var oscServer = new osc.Server(9001, '0.0.0.0')
oscServer.on('message', function (msg, rinfo) {
  const path = msg.shift()
  const ident = msg.shift()
  const data = msg

  console.log(path, ident, data.length)
})

var isStopping = false
function shutdown () {
  if (isStopping) {
    return
  } else {
    isStopping = true
  }

  console.info('Got SIGTERM. Graceful shutdown start', new Date().toISOString())

  if (connected) {
    client.send('/unsubscribe', 'HOT.ALL', function () {
      process.exit()
    })
  } else {
    process.exit()
  }

  setTimeout(() => {
    console.log('Forcing shutdown after 30sec')
    process.exit()
  }, 30 * 1000)
}

process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
