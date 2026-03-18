// DMMぱちタウンのデータ構造調査スクリプト
const https = require('https');

https.get('https://p-town.dmm.com/shops/tokyo/148/jackpot', { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    // データ系のリンクを探す
    const dataLinks = d.match(/href="([^"]*data[^"]*)"/gi) || [];
    console.log('--- Data Links ---');
    dataLinks.slice(0, 10).forEach(l => console.log(l));

    // iframe が埋め込まれていないか確認（外部データサービス呼び出し）
    const iframes = d.match(/<iframe[^>]*>/gi) || [];
    console.log('\n--- Iframes ---');
    iframes.forEach(i => console.log(i));
    
    // PAPIMO や Daikoku などのキーワード
    console.log('\n--- Keywords ---');
    console.log('papimo:', d.includes('papimo'));
    console.log('daikoku:', d.includes('daikoku'));
    console.log('site777:', d.includes('site777'));
    console.log('v-space:', d.includes('v-space'));
    
    // スクリプト内の JSON や API エンドポイント
    const apiMatch = d.match(/https?:\/\/[^\s"']+\/api\/[^\s"']+/gi) || [];
    console.log('\n--- API Match ---');
    apiMatch.slice(0, 5).forEach(m => console.log(m));
  });
});
