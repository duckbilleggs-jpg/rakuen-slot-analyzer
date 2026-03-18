// d-deltanet で錦糸町 (みとやジャックポット) の正しいパラメータを探すスクリプト
const https = require('https');
const iconv = require('iconv-lite');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if ([301, 302, 303].includes(res.statusCode) && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(iconv.decode(Buffer.concat(chunks), 'Shift_JIS')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  // エリア検索ページで東京のホール一覧を取得
  console.log('d-deltanet トップページを取得中...');
  const top = await fetch('https://www.d-deltanet.com/pc/D0001.do');
  
  // pmc を含むリンクを全て抽出
  const linkPattern = /href="([^"]*D0301\.do\?pmc=(\d+)[^"]*)"/g;
  let match;
  const halls = [];
  while ((match = linkPattern.exec(top)) !== null) {
    halls.push({ url: match[1], pmc: match[2] });
  }
  console.log(`見つかったホール数: ${halls.length}`);
  
  // みとや or ジャックポット を含むリンクを探す
  const mitoya = top.match(/みとや[^<]*/g);
  console.log('みとや テキスト:', mitoya);
  
  // 東京エリアのリンクを探す
  const tokyoLinks = top.match(/href="[^"]*13\d{6}[^"]*"/g);
  console.log('東京エリアリンク:', tokyoLinks ? tokyoLinks.slice(0, 5) : 'なし');
  
  // 直接エリア検索: 東京都墨田区
  console.log('\n東京都墨田区エリア(acd=13107)を検索中...');
  const area = await fetch('https://www.d-deltanet.com/pc/D0101.do?acd=13107');
  
  const areaLinks = [];
  const areaPattern = /href="([^"]*D0301\.do\?pmc=(\d+)[^"]*)"/g;
  while ((match = areaPattern.exec(area)) !== null) {
    areaLinks.push({ url: match[1], pmc: match[2] });
  }
  
  // テキストからホール名を抽出
  const hallNames = area.match(/<a[^>]*D0301[^>]*>([^<]+)</g);
  console.log('墨田区のホール:');
  if (hallNames) {
    hallNames.forEach(h => console.log('  ', h.replace(/<a[^>]*>/, '').trim()));
  }
  console.log('リンク:', areaLinks);
  
  // pmc=13027 で始まるものを探す
  const filtered = areaLinks.filter(l => l.pmc.startsWith('130'));
  console.log('\n東京都のホール:', filtered);
  
  process.exit(0);
})();
