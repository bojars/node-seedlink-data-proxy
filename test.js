var osc = require('node-osc')

var client = new osc.Client('127.0.0.1', 9002)
client.send('/subscribe', 'NL.HGN', function () {
  client.kill()
})

var oscServer = new osc.Server(9001, '0.0.0.0')
oscServer.on('message', function (msg, rinfo) {
  console.log(msg)
})
