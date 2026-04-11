const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.join(__dirname, '.env');

require('dotenv').config({ path: envPath });

try {
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  for (const key of Object.keys(parsed)) {
    const cur = process.env[key];
    if (cur === undefined || cur === '') {
      process.env[key] = parsed[key];
    }
  }
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
