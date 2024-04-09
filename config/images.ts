// PBLZL2

import { PaintingModel, PaintingStatic } from '../models'
import http from 'http'
import https from 'https'

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
    .then(uploadPaintings)
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
    http.get('http://localhost:1337/paintings/' + painting.filename, (res) => {
      if (res.statusCode === 404) {
        console.log('404', painting.filename)
      }
    })
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

let paintingQueue: PaintingModel[] = []

function uploadPaintings(paintings: PaintingModel[]) {
  paintingQueue = paintings
  uploadPainting(paintings.pop()).then(pickPaintingAndUpload)
  uploadPainting(paintings.pop()).then(pickPaintingAndUpload)
  uploadPainting(paintings.pop()).then(pickPaintingAndUpload)
}

function pickPaintingAndUpload() {
  if (paintingQueue.length > 0) {
    const painting = paintingQueue.pop()
    uploadPainting(painting)
      .then(pickPaintingAndUpload)
  }
}

async function uploadPainting(painting: PaintingModel) {
  return new Promise((resolve, reject) => {
    if (painting.url) {
      console.log(`Already uploaded ${painting.id} ${painting.url}`)
      resolve(painting)
      return
    }

    // Check filesize is less than 20MB
    const stats = fs.statSync(`${__dirname}/../data/paintings/${painting.filename}`)
    if (stats.size > 20 * 1024 * 1024) {
      console.log(`Filesize too large ${painting.id} ${painting.filename}`)
      resolve(null)
      return
    }

    const caption = painting.title
      .replace(/'/g, '&apos;')
      .replace(/"/g, '&quot;')
      .replace(/`/g, '&grave;')
      .replace(/’/g, '&rsquo;')
      .replace(/‘/g, '&lsquo;')
      .replace(/“/g, '&ldquo;')
      .replace(/”/g, '&rdquo;')
      .replace(/–/g, '&ndash;')
      .replace(/—/g, '&mdash;')
      .replace(/…/g, '&hellip;')
      .replace(/©/g, '&copy;')
      .replace(/®/g, '&reg;')
      .replace(/™/g, '&trade;')
      .replace(/°/g, '&deg;')
      .replace(/µ/g, '&micro;')
      .replace(/½/g, '&frac12;')
      .replace(/¼/g, '&frac14;')
      .replace(/¾/g, '&frac34;')
      .replace(/é/g, '&eacute;')
      .replace(/è/g, '&egrave;')
      .replace(/ç/g, '&ccedil;')
      .replace(/É/g, '&Eacute;')
      .replace(/Î/g, '&Icirc;')

    https.get(
      'https://upload.david-ma.net/uploadByUrl',
      {
        headers: {
          album: '2qwT3k',
          target: `https://david-ma.net/monet/paintings/${painting.filename}`,
          caption: caption,
          keywords: `Monet, Impressionism, ${painting.yearStart}, ${painting.yearEnd}`,
        },
        timeout: 120000,
      },
      (res) => {
        let rawData = ''
        res.on('data', (d) => {
          rawData += d
        })
        res.on('error', (e) => {
          console.error(e)
          console.error(`Error on painting ${painting.id} ${painting.title} ${painting.filename}`)
        })
        res.on('end', () => {
          try {
            const data = JSON.parse(rawData)
            console.log(data)
            if (data.Code === 400) {
              throw new Error(`(400) ${data.Message}`)
            }
            painting
              .update({
                url: data.image_url,
                imageKey: data.imageKey,
              })
              .then((newPainting) => {
                console.log(
                  `Updated painting ${painting.id} ${newPainting.url}`
                )
                resolve(newPainting)
              })
          } catch (e) {
            console.error(e)
            reject(e)
          }
        })
      }
    )
  })
}
