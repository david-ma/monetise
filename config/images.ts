// PBLZL2

import { PaintingModel, PaintingStatic } from '../models'
import http from 'http'

// fs read files in directory data/Monet

const fs = require('fs')
const Painting: PaintingStatic = require('./db_bootstrap').seq.Painting

// Drop table painting
// Painting.sync({ 
//   alter: true,
//   force: true
// })

// console.log("this should drop paintings")
// process.exit()

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
      }).then((painting) => painting[0])
    })
  )
  // .then(copyPaintings)
  .then(viewPaintings)
})

function fixFilenames(paintings: PaintingModel[]) {
  paintings.forEach((painting) => {
    const newFilename = painting.filename
      .replace('_.jpg', '.jpg')
      .replace(/É/g, 'E')
      .replace(/[éè]/g, 'e')
      .replace('ç', 'c')
      .replace('Î', 'I')

    painting.update({
      filename: newFilename,
    })
  })
  return paintings
}

function viewPaintings(paintings: PaintingModel[]) {
  console.log('Paintings', paintings.length)
  paintings.forEach((painting) => {

    // Check we don't have 404 at localhost:1337/paintings/filename
    http.get(
      'http://localhost:1337/paintings/' + painting.filename,
      (res) => {
        if (res.statusCode === 404) {
          console.log('404', painting.filename)
        }
      }
    )
  })
  return paintings
}

function checkPaintings(paintings: PaintingModel[]) {
  paintings.forEach((painting) => {
    // Find weird chaaracters:
    if (painting.title.match(/[^a-zA-Z0-9ÉéèçÎ-\s]/)) {
      console.log('Weird characters in title', painting.title)
    }
  })
}

function copyPaintings(paintings: PaintingModel[]) {
  paintings.forEach((painting) => {
    const newFilename = painting.filename
      .replace(/É/g, 'E')
      .replace(/[éè]/g, 'e')
      .replace(/ç/g, 'c')
      .replace(/Î/g, 'I')
      .replace(/[^a-zA-Z0-9-]/g, '_')
      .replace(/_+/g, '_')
      .replace('_jpg', '.jpg')
      .replace('_.jpg', '.jpg')

      fs.copyFile(
      `${__dirname}/../data/Monet/${painting.filename}`,
      `${__dirname}/../data/paintings/${newFilename}`,
      (err) => {
        if (err) {
          console.error(err)
          return
        }
        painting.update({
          filename: newFilename,
        })
      }
    )
  })
}

function uploadPaintings(paintings: PaintingModel[]) {
  console.log('Ok, now do upload the paintings somewhere', paintings.length)
  paintings.forEach((painting) => {
    console.log('Painting', painting.dataValues)
  })
}
