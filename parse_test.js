/**
 * parse_test.js - 保存したHTMLからデータを抽出するテスト
 */
const cheerio = require('cheerio');
const fs = require('fs');

const html = fs.readFileSync('ddelta_data_list.html', 'utf-8');
const $ = cheerio.load(html);

console.log('--- Table Analysis ---');
const results = [];

// データが入っていそうな特定のクラスやIDを探す
// d-deltanet の「大当り一覧」は各要素が div ベースで組まれているか、特殊な table かを確認
let tableFound = false;

$('table').each((i, tbl) => {
    const rows = $(tbl).find('tr');
    if (rows.length > 5) { // データ行が多そうなテーブルをターゲット
        tableFound = true;
        console.log(`Found data table. Rows: ${rows.length}`);
        
        let header = [];
        rows.each((j, tr) => {
            const cells = $(tr).find('td, th');
            const rowData = cells.map((k, c) => $(c).text().trim().replace(/\s+/g, '')).get();
            
            if (j === 0 || rowData.includes('台番')) {
                // ヘッダー行とみなし保持
                header = rowData;
                console.log(`Header: ${header.join(', ')}`);
            } else if (rowData.length > 0) {
                // データ行
                const obj = {};
                rowData.forEach((val, idx) => {
                    if (header[idx]) {
                        obj[header[idx]] = val;
                    } else {
                        obj[`col_${idx}`] = val;
                    }
                });
                
                // 台番っぽいのがあるか確認
                if (obj['台番'] || parseInt(obj['col_0'])) {
                     results.push(obj);
                }
            }
        });
    }
});

// もし table 要素ではなく div でリストが組まれていた場合
if (!tableFound || results.length === 0) {
    console.log('No suitable table found. Searching for div/list structures...');
    
    // ".list_box"や ".data_box" などのよくあるクラス名を検索
    $('.list_data, .list_box, .data_row, div[class*="data"], div[class*="list"]').each((i, el) => {
        const text = $(el).text().trim().replace(/\s+/g, ' ');
        // 123番台 みたいな数字が含まれるかチェック
        if (/\d+/.test(text) && text.length > 10) {
            console.log(`Div Row ${i}: ${text}`);
            results.push({ rawText: text });
        }
    });
}

console.log(`\nExtracted ${results.length} valid rows.`);
if (results.length > 0) {
    console.log(JSON.stringify(results.slice(0, 5), null, 2)); // 最初の5件だけ表示
} else {
    // 構造が全く違う場合、とりあえずbodyの中身を少し出す
    console.log("No data matched. Dumping snippet:");
    console.log($('body').text().replace(/\s+/g, ' ').substring(0, 500));
}
