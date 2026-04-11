const fs = require('fs');
const key = fs.readFileSync('./zap-shift-c5f1a-firebase-adminsdk-fbsvc-b621e760b6.json', 'utf8')
const base64 = Buffer.from(key).toString('base64')
console.log(base64)