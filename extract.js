const fs = require('fs');
const html = fs.readFileSync('pscube_models.html', 'utf8');

// Find eval(function(p,a,c,k,e,d)
const startIndex = html.indexOf('eval(function(p,a,c,k,e,d)');
if (startIndex !== -1) {
    let endIndex = html.indexOf('</script>', startIndex);
    let codeStr = html.substring(startIndex, endIndex).trim();
    if (codeStr.endsWith(';')) codeStr = codeStr.slice(0, -1);
    if (codeStr.endsWith(')')) codeStr = codeStr.slice(0, -1);
    codeStr = codeStr.substring(5); // remove "eval("

    // Execute the unpacker
    const unpacked = eval(`(${codeStr})`);
    fs.writeFileSync('unpacked.js', unpacked, 'utf8');
    console.log('Successfully unpacked to unpacked.js');
} else {
    console.log('Could not find eval packer');
}
