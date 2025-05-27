// inspect.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./db.sqlite');

db.all("SELECT * FROM purchases", [], (err, rows) => {
    if (err) console.error(err);
    else console.table(rows);
    db.close();
});
