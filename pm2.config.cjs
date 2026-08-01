/**
 * This is the PM2 config for the Monetise server.
 */

const path = require('path')

module.exports = {
  apps: [
    {
      name: 'monetise',
      cwd: __dirname,
      script: 'node_modules/.bin/thalia',
      env: {
        NODE_ENV: 'production',
        PORT: 7777,
        NODE_OPTIONS: '--max_http_header_size=65536',
      },
      error_file: path.join(__dirname, 'data/logs/pm2-error.log'),
      out_file: path.join(__dirname, 'data/logs/pm2-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
}
