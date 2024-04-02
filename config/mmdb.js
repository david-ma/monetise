"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadCitiesData = void 0;
const https_1 = __importDefault(require("https"));
const fs_1 = __importDefault(require("fs"));
const zlib_1 = __importDefault(require("zlib"));
async function downloadCitiesData() {
    return new Promise((resolve, reject) => {
        if (fs_1.default.existsSync(`${__dirname}/../data/city.mmdb`)) {
            resolve('city.mmdb already exists');
        }
        else {
            const date = new Date().toISOString().slice(0, 7);
            let mb = 0;
            let logger = 0;
            https_1.default.get(`https://download.db-ip.com/free/dbip-city-lite-${date}.mmdb.gz`, (response) => {
                const file = fs_1.default.createWriteStream(`${__dirname}/../data/city.mmdb.gz`);
                response.pipe(file);
                response.on('data', (chunk) => {
                    mb += chunk.length / (1024 * 1024);
                    if (logger++ % 20 === 0)
                        console.log(`Received ${Math.round(mb * 100) / 100} mb of data.`);
                });
                response.on('end', () => {
                    fs_1.default.createReadStream(`${__dirname}/../data/city.mmdb.gz`)
                        .pipe(zlib_1.default.createGunzip())
                        .pipe(fs_1.default.createWriteStream(`${__dirname}/../data/city.mmdb`))
                        .on('finish', () => {
                        fs_1.default.promises
                            .unlink(`${__dirname}/../data/city.mmdb.gz`)
                            .then(() => {
                            resolve('Downloaded and extracted city.mmdb');
                        });
                    });
                });
            });
        }
    });
}
exports.downloadCitiesData = downloadCitiesData;
