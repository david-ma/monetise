import https from 'https'
import fs from 'fs'
import zlib from 'zlib'

export async function downloadCitiesData() {
  return new Promise((resolve, reject) => {
    // Check if the city.mmdb file exists
    if (fs.existsSync(`${__dirname}/../data/city.mmdb`)) {
      resolve('city.mmdb already exists')
    } else {
      const date = new Date().toISOString().slice(0, 7)
      let mb = 0
      let logger = 0
      // download file and gunzip it
      https.get(
        `https://download.db-ip.com/free/dbip-city-lite-${date}.mmdb.gz`,
        (response) => {
          const file = fs.createWriteStream(`${__dirname}/../data/city.mmdb.gz`)
          response.pipe(file)

          response.on('data', (chunk) => {
            mb += chunk.length / (1024 * 1024)
            if (logger++ % 20 === 0)
              console.log(`Received ${Math.round(mb * 100) / 100} mb of data.`)
          })

          response.on('end', () => {
            fs.createReadStream(`${__dirname}/../data/city.mmdb.gz`)
              .pipe(zlib.createGunzip())
              .pipe(fs.createWriteStream(`${__dirname}/../data/city.mmdb`))
              .on('finish', () => {
                fs.promises
                  .unlink(`${__dirname}/../data/city.mmdb.gz`)
                  .then(() => {
                    resolve('Downloaded and extracted city.mmdb')
                  })
              })
          })
        }
      )
    }
  })
}
