const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = 3001;

// 启用CORS和JSON解析
app.use(cors());
app.use(express.json());

// FastGPT 代理路由
app.post('/api/fastgpt/*', async (req, res) => {
    try {
        const fastgptPath = req.path.replace('/api/fastgpt', '');
        const fastgptUrl = `https://api.fastgpt.in/api${fastgptPath}`;
        
        console.log('🔄 代理请求:', fastgptUrl);
        console.log('📝 请求体:', req.body);
        
        const response = await fetch(fastgptUrl, {
            method: req.method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': req.headers.authorization
            },
            body: JSON.stringify(req.body)
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            console.error('❌ FastGPT错误:', response.status, data);
            return res.status(response.status).json(data);
        }
        
        console.log('✅ FastGPT响应成功');
        res.json(data);
        
    } catch (error) {
        console.error('❌ 代理服务器错误:', error);
        res.status(500).json({ 
            error: 'Proxy server error', 
            message: error.message 
        });
    }
});

// 健康检查接口
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'FastGPT代理服务器运行正常' });
});

app.listen(PORT, () => {
    console.log(`🚀 FastGPT代理服务器启动成功`);
    console.log(`📡 服务地址: http://localhost:${PORT}`);
    console.log(`🔧 代理路径: /api/fastgpt/*`);
    console.log(`💡 健康检查: http://localhost:${PORT}/health`);
});

module.exports = app; 