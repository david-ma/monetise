// PBLZL2

// fs read files in directory data/Monet

const fs = require('fs')
const Painting = require('./db_bootstrap').seq.Painting

// Drop table painting
// Painting.sync({ force: true })

fs.readdir(`${__dirname}/../data/Monet`, (err, files) => {
  if (err) {
    console.error(err)
    return
  }

  // Filter files
  files = files.filter((file) => {
    return file.match(/\.jpg$/)
  })

  Promise.all(
    files.map((filename, i) => {
      const string = filename.split('.jpg')[0]
      const result = string.match(/(.*) \((?:ca. )?(\d{4})[–-]?(\d\d\d\d)?\)/)
      let title = string,
        yearStart = null,
        yearEnd = null,
        id = i + 1

      if (result && result.length > 2) {
        title = result[1]
        yearStart = parseInt(result[2])
      }
      if (result && result[3]) {
        yearEnd = parseInt(result[3])
      }

      return Painting.findOrCreate({
        where: {
          id,
        },
        defaults: {
          id,
          title,
          yearStart,
          yearEnd,
          filename,
        },
      })
    })
  ).then(uploadPaintings)
})

function uploadPaintings(paintings) {
  console.log('Ok, now do upload the paintings somewhere')
}
