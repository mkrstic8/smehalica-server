const fs = require('fs');

const data = fs.readFileSync('./serbian-words.txt', 'utf8');
const words = data.split(/[\n\r]+/)
    .map(w => w.trim().toUpperCase())
    .filter(w => /^[АБВГДЂЕЖЗИЈКЛЉМНЊОПРСТЋУФХЦЧЏШ]+$/.test(w))
    .filter(w => w.length >= 2 && w.length <= 10);  // samo do 10 slova

const unique = [...new Set(words)];
fs.writeFileSync('./serbian-words.txt', unique.join('\n'));
console.log(`✅ Spakovano ${unique.length} reči (2-10 slova)`);