const { exec } = require('child_process')


const execAsync = (command) => (
  new Promise((resolve, reject) => {
    exec(command, (error, stdout) => {
      console.log(stdout)

      if (error) {
        reject(error)
      }
      else {
        resolve(stdout.trim())
      }
    })
  })
)


module.exports = execAsync
