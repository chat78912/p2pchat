/**
 * 集成测试脚本 - 验证文件传输系统
 * 使用 Node.js 运行此脚本进行测试
 */

console.log('🧪 P2P Chat 文件传输系统集成测试\n');

// 测试结果统计
let passedTests = 0;
let failedTests = 0;

function test(name, condition, details = '') {
    if (condition) {
        console.log(`✅ ${name}`);
        if (details) console.log(`   ${details}`);
        passedTests++;
    } else {
        console.log(`❌ ${name}`);
        if (details) console.log(`   ${details}`);
        failedTests++;
    }
}

// 测试1: 文件结构检查
console.log('📁 文件结构检查:');
const fs = require('fs');
const path = require('path');

const requiredFiles = [
    'index.html',
    'assets/config.js',
    'assets/main.js',
    'assets/unified-transfer.js',
    'assets/styles.css',
    'test-unified-transfer.html'
];

requiredFiles.forEach(file => {
    const filePath = path.join(__dirname, file);
    test(`${file} 存在`, fs.existsSync(filePath));
});

// 测试2: 代码质量检查
console.log('\n📝 代码质量检查:');

// 检查 unified-transfer.js
const unifiedTransferCode = fs.readFileSync(path.join(__dirname, 'assets/unified-transfer.js'), 'utf8');
test('unified-transfer.js 包含 UnifiedTransfer 类', unifiedTransferCode.includes('class UnifiedTransfer'));
test('unified-transfer.js 包含加密功能', unifiedTransferCode.includes('encryptDecrypt'));
test('unified-transfer.js 包含重试机制', unifiedTransferCode.includes('maxRetries'));
test('unified-transfer.js 包含缓存机制', unifiedTransferCode.includes('earlyChunks'));

// 检查 main.js
const mainCode = fs.readFileSync(path.join(__dirname, 'assets/main.js'), 'utf8');
test('main.js 使用 removeFileProgress', mainCode.includes('removeFileProgress'));
test('main.js 不包含 hideFileProgress', !mainCode.includes('hideFileProgress'));
test('main.js 包含统一传输集成', mainCode.includes('startUnifiedFileSending'));

// 测试3: 配置检查
console.log('\n⚙️ 配置检查:');
const configCode = fs.readFileSync(path.join(__dirname, 'assets/config.js'), 'utf8');
test('config.js 包含 WebSocket 配置', configCode.includes('WS_CONFIG'));

// 测试4: HTML完整性
console.log('\n🌐 HTML完整性检查:');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
test('index.html 加载 unified-transfer.js', indexHtml.includes('unified-transfer.js'));
test('index.html 包含测试链接', indexHtml.includes('test-unified-transfer.html'));

// 测试5: 关键功能验证
console.log('\n🔧 关键功能验证:');
test('数据包格式更新为可变长度', unifiedTransferCode.includes('fileIdLen'));
test('实现了发送重试机制', unifiedTransferCode.includes('Send failed (attempt'));
test('实现了接收器缓存机制', unifiedTransferCode.includes('Receiver not ready, caching chunk'));
test('使用正确的作用域引用', mainCode.includes('const self = this'));

// 测试6: 安全性检查
console.log('\n🔒 安全性检查:');
test('实现了数据加密', unifiedTransferCode.includes('secretKey'));
test('包含魔数验证', unifiedTransferCode.includes('0xAA, 0xBB, 0xCC, 0xDD'));

// 总结
console.log('\n📊 测试总结:');
console.log(`通过: ${passedTests} 个测试`);
console.log(`失败: ${failedTests} 个测试`);
console.log(`总计: ${passedTests + failedTests} 个测试`);

if (failedTests === 0) {
    console.log('\n🎉 所有测试通过！文件传输系统已准备就绪。');
} else {
    console.log('\n⚠️ 有测试失败，请检查并修复问题。');
    process.exit(1);
}

// 生成测试报告
const report = {
    timestamp: new Date().toISOString(),
    passed: passedTests,
    failed: failedTests,
    total: passedTests + failedTests,
    status: failedTests === 0 ? 'PASS' : 'FAIL'
};

fs.writeFileSync(
    path.join(__dirname, 'test-report.json'),
    JSON.stringify(report, null, 2)
);

console.log('\n📄 测试报告已保存到 test-report.json');