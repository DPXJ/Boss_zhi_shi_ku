// API配置 - 用户配置信息
let API_CONFIG = {
    // 阿里云OSS配置
    OSS: {
        region: 'oss-cn-beijing',
        accessKeyId: '',
        accessKeySecret: '',
        bucket: 'tian-jiu-boss-zhishiku',
        endpoint: 'https://oss-cn-beijing.aliyuncs.com'
    },
    // FastGPT配置 - 风格分析
    FASTGPT_STYLE: {
        baseUrl: 'https://api.fastgpt.in/api', // FastGPT官方API地址
        apiKey: 'fastgpt-oCBXIfsNzyuNuzlq3LDXoe8v73SFg4g2MbVKV8GXMMxMpYBRlLyw6', // 风格分析专用密钥
        workflowId: '685c9d7e6adb97a0858caaa6' // 风格分析工作流ID
    },
    // FastGPT配置 - 内容生成
    FASTGPT_CONTENT: {
        baseUrl: 'https://api.fastgpt.in/api', // FastGPT官方API地址
        apiKey: 'fastgpt-p2WSK5LRZZM3tVzk0XRT4vERkQ2PYLXi6rFAZdHzzuB7mSicDLRBXiymej', // 内容生成专用密钥
        workflowId: '685f87df49b71f158b57ae61' // 内容创作工作流ID
    },
    // 接口模式选择：'workflow' 或 'chat'
    MODE: 'chat' // 默认使用对话接口模式
};

// 全局状态管理
const appState = {
    uploadedFiles: [],
    urls: [],
    fileUrls: [], // 存储OSS上传后的URL数组
    styleOutput: null, // 风格分析结果
    generatedContent: null,
    isUploading: false,
    isAnalyzing: false,
    isGenerating: false,
    chatId: null // 用于对话接口的chatId
};

// 初始化阿里云OSS客户端
let ossClient = null;
let actualBucket = null; // 实际可用的bucket名称

async function initializeOSS() {
    if (!API_CONFIG.OSS.accessKeyId || !API_CONFIG.OSS.accessKeySecret) {
        console.warn('OSS配置不完整，无法初始化OSS客户端');
        return;
    }
    
    try {
        // 先创建基础OSS客户端（不指定bucket）
        ossClient = new OSS({
            region: API_CONFIG.OSS.region,
            accessKeyId: API_CONFIG.OSS.accessKeyId,
            accessKeySecret: API_CONFIG.OSS.accessKeySecret,
            secure: true,
            timeout: 60000
        });
        
        console.log('OSS客户端基础初始化成功');
        
        // 自动查找或创建可用的bucket
        await setupBucket();
        
    } catch (error) {
        console.error('OSS初始化失败:', error);
        showToast('OSS初始化失败: ' + error.message, 'error');
    }
}

// 设置bucket - 直接使用指定的bucket
async function setupBucket() {
    try {
        // 直接使用配置的bucket
        actualBucket = API_CONFIG.OSS.bucket;
        console.log('使用指定的bucket:', actualBucket);
        
        // 重新初始化OSS客户端，指定bucket
        ossClient = new OSS({
            region: API_CONFIG.OSS.region,
            accessKeyId: API_CONFIG.OSS.accessKeyId,
            accessKeySecret: API_CONFIG.OSS.accessKeySecret,
            bucket: actualBucket,
            secure: true,
            timeout: 60000
        });
        
        console.log('✅ OSS完整初始化成功，使用bucket:', actualBucket);
        
        // 测试bucket连接和权限
        await testOSSUpload();
        
        showToast('OSS连接成功', 'success');
        
    } catch (error) {
        console.error('OSS设置失败:', error);
        
        if (error.status === 403) {
            showToast('OSS权限不足，请检查AccessKey权限', 'error');
        } else if (error.status === 404) {
            showToast('Bucket不存在，请检查bucket名称', 'error');
        } else {
            showToast('OSS连接失败: ' + error.message, 'error');
        }
    }
}

// 测试OSS上传功能
async function testOSSUpload() {
    try {
        const testFile = new Blob(['OSS test'], { type: 'text/plain' });
        const testFilename = `test/${Date.now()}-test.txt`;
        
        const result = await ossClient.put(testFilename, testFile);
        console.log('✅ OSS上传测试成功');
        
        // 清理测试文件
        await ossClient.delete(testFilename);
        console.log('✅ OSS删除测试成功');
        
        updateAnalysisStatus('OSS配置完成，可以上传文件');
        
    } catch (error) {
        console.error('OSS功能测试失败:', error);
        throw error;
    }
}

// 简化的文件上传到OSS
async function uploadFilesToOSS(files) {
    if (!ossClient || !actualBucket) {
        throw new Error('OSS未正确初始化或bucket不可用');
    }
    
    const uploadResults = [];
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const filename = `boss-kb/${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${file.name}`;
        
        try {
            console.log(`正在上传文件: ${file.name}`);
            
            const result = await ossClient.put(filename, file, {
                headers: {
                    'Content-Type': file.type || 'application/octet-stream'
                }
            });
            
            console.log(`✅ 文件上传成功: ${file.name}`);
            uploadResults.push(result.url);
            
        } catch (error) {
            console.error(`❌ 文件上传失败: ${file.name}`, error);
            throw new Error(`文件 ${file.name} 上传失败: ${error.message}`);
        }
    }
    
    return uploadResults;
}

// 调用FastGPT工作流接口（风格分析）
async function callStyleAnalysisWorkflow(articleUrls) {
    console.log('🔄 调用FastGPT风格分析工作流...');
    console.log('文件URLs:', articleUrls);
    
    if (!API_CONFIG.FASTGPT_STYLE.workflowId) {
        throw new Error('风格分析工作流ID未配置，请先配置workflowId');
    }
    
    const response = await fetch(`${API_CONFIG.FASTGPT_STYLE.baseUrl}/workflow/run`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_CONFIG.FASTGPT_STYLE.apiKey}`
        },
        body: JSON.stringify({
            workflowId: API_CONFIG.FASTGPT_STYLE.workflowId,
            variables: {
                article_input: articleUrls
            }
        })
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('FastGPT工作流错误响应:', response.status, errorText);
        throw new Error(`风格分析工作流调用失败: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    console.log('✅ FastGPT风格分析工作流响应:', result);
    
    // 从工作流输出中获取style_output
    if (result && result.style_output) {
        return result.style_output;
    }
    
    // 如果没有style_output，尝试从其他可能的字段获取
    if (result && result.data && result.data.style_output) {
        return result.data.style_output;
    }
    
    console.warn('工作流响应格式异常:', result);
    throw new Error('无法从工作流获取风格分析结果');
}

// 调用FastGPT工作流接口（内容生成）
async function callContentGenerationWorkflow(styleOutput, contentLength, topic, styleType, remark) {
    console.log('🔄 调用FastGPT内容生成工作流...');
    console.log('参数:', { styleOutput, contentLength, topic, styleType, remark });
    
    if (!API_CONFIG.FASTGPT_CONTENT.workflowId) {
        throw new Error('内容生成工作流ID未配置，请先配置workflowId');
    }
    
    const response = await fetch(`${API_CONFIG.FASTGPT_CONTENT.baseUrl}/workflow/run`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_CONFIG.FASTGPT_CONTENT.apiKey}`
        },
        body: JSON.stringify({
            workflowId: API_CONFIG.FASTGPT_CONTENT.workflowId,
            variables: {
                style_output: styleOutput,
                content_length: contentLength,
                topic: topic,
                style_type: styleType,
                remark: remark || ''
            }
        })
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('FastGPT工作流错误响应:', response.status, errorText);
        throw new Error(`内容生成工作流调用失败: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    console.log('✅ FastGPT内容生成工作流响应:', result);
    
    // 从工作流输出中获取AIcontent_output
    if (result && result.AIcontent_output) {
        return result.AIcontent_output;
    }
    
    // 如果没有AIcontent_output，尝试从其他可能的字段获取
    if (result && result.data && result.data.AIcontent_output) {
        return result.data.AIcontent_output;
    }
    
    console.warn('工作流响应格式异常:', result);
    throw new Error('无法从工作流获取内容生成结果');
}

// 新增：FastGPT 对话接口调用
async function callChatCompletions(messages, customUid = null) {
    console.log('🔄 调用FastGPT对话接口...');
    console.log('消息:', messages);
    
    // 生成或使用已存在的chatId
    if (!appState.chatId) {
        appState.chatId = Date.now().toString();
    }
    
    const requestBody = {
        chatId: appState.chatId,
        stream: false,
        detail: false,
        messages: messages
    };
    
    // 如果提供了自定义用户ID，添加到请求中
    if (customUid) {
        requestBody.customUid = customUid;
    }
    
    const response = await fetch(`${API_CONFIG.FASTGPT_CONTENT.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_CONFIG.FASTGPT_CONTENT.apiKey}`
        },
        body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('FastGPT对话接口错误响应:', response.status, errorText);
        
        // 特殊处理常见错误
        if (errorText.includes('Key is error')) {
            throw new Error('API密钥错误：请使用应用专用密钥而不是账户密钥');
        }
        
        throw new Error(`对话接口调用失败: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    console.log('✅ FastGPT对话接口响应:', result);
    
    // 从响应中提取内容
    if (result && result.choices && result.choices[0] && result.choices[0].message) {
        return result.choices[0].message.content;
    }
    
    console.warn('对话接口响应格式异常:', result);
    throw new Error('无法从对话接口获取响应内容');
}

// 新增：使用对话接口进行风格分析
async function analyzeStyleWithChat(articleUrls) {
    const messages = [
        {
            role: "user",
            content: `请分析以下文档链接中的写作风格特点：

${articleUrls.map((url, index) => `${index + 1}. ${url}`).join('\n')}

请从以下几个方面分析写作风格：
1. 语言特点（正式/非正式、简洁/详细）
2. 句式结构（长短句比例、复杂度）
3. 用词偏好（专业术语、常用词汇）
4. 表达习惯（逻辑结构、过渡词）
5. 整体语调（严肃/轻松、客观/主观）

请用简洁的语言总结出主要的风格特征。`
        }
    ];
    
    return await callChatCompletions(messages);
}

// 新增：使用对话接口进行内容生成
async function generateContentWithChat(styleOutput, contentLength, topic, styleType, remark) {
    const messages = [
        {
            role: "user",
            content: `请根据以下要求生成内容：

**写作风格参考：**
${styleOutput}

**内容要求：**
- 主题：${topic}
- 文档类型：${getContentTypeDisplayName(styleType)}
- 字数要求：${contentLength || '适中'}字
- 补充说明：${remark || '无'}

请严格按照参考的写作风格，生成一份${getContentTypeDisplayName(styleType)}。
要求语言风格与参考保持一致，内容结构完整，逻辑清晰。`
        }
    ];
    
    return await callChatCompletions(messages);
}

// 辅助函数：获取内容类型显示名称
function getContentTypeDisplayName(type) {
    const typeMap = {
        'speech': '发言稿',
        'email': '工作邮件',
        'meeting': '会议纪要',
        'announcement': '工作安排',
        'report': '工作汇报',
        'letter': '正式函件'
    };
    return typeMap[type] || '文档';
}

// 本地备用内容生成
function generateFallbackContent(topic, contentType, contentLength, notes) {
    const templates = {
        speech: `各位同事：

大家好！今天我要就"${topic}"这个重要议题与大家交流。

通过深入分析和思考，我认为我们需要从以下几个方面来推进这项工作：

一、充分认识重要性
${topic}关系到我们整体发展大局，必须高度重视，统一思想，形成共识。

二、明确目标任务
我们的目标是要通过扎实有效的工作，确保各项任务落实到位，取得实实在在的成果。

三、强化责任担当
各部门要切实履行职责，主动作为，确保工作有序推进，不出任何纰漏。

${notes ? `\n补充说明：\n${notes}` : ''}

希望大家以高度的责任感和使命感，全力以赴做好相关工作。我相信，在大家的共同努力下，我们一定能够圆满完成各项任务。

谢谢大家！`,

        email: `各位同事：

关于"${topic}"事宜，现将相关安排通知如下：

根据工作需要和实际情况，经研究决定，就此项工作做出如下安排：

1. 各部门要高度重视，认真组织实施
2. 严格按照时间节点，确保各项工作按时完成
3. 加强沟通协调，及时解决工作中遇到的问题

${notes ? `\n特别说明：\n${notes}` : ''}

请各位同事务必按照要求抓好落实。如有疑问，请及时与我联系。

此致
敬礼！`,

        meeting: `会议纪要

会议主题：${topic}
会议时间：${new Date().toLocaleDateString('zh-CN')}
参会人员：相关部门负责人

会议主要内容：

一、会议背景
针对${topic}相关工作，需要统一思想，明确任务，确保各项工作有序推进。

二、主要议题
1. 分析当前形势和存在的问题
2. 明确下一步工作重点和措施
3. 强化责任分工和时间节点

三、会议要求
1. 各部门要高度重视，认真落实会议精神
2. 加强沟通协调，形成工作合力
3. 定期汇报进展情况

${notes ? `\n会议补充：\n${notes}` : ''}

会议取得了预期效果，为下一步工作奠定了良好基础。`,

        announcement: `关于${topic}的工作安排

各部门：

为做好${topic}相关工作，现就有关事项安排如下：

一、工作目标
通过扎实有效的工作措施，确保各项任务顺利完成，取得预期成效。

二、责任分工
1. 各部门要根据职能分工，明确责任
2. 建立工作台账，实行清单管理
3. 定期督查检查，确保工作质量

三、时间要求
请各部门于本月底前完成相关工作，并及时报送工作情况。

${notes ? `\n特别要求：\n${notes}` : ''}

请各部门高度重视，认真组织实施，确保工作取得实效。

特此通知。`,

        report: `关于${topic}工作情况的汇报

根据要求，现将${topic}工作情况汇报如下：

一、工作开展情况
我们高度重视此项工作，精心组织，周密部署，各项工作有序推进。

二、主要成效
1. 思想认识进一步统一
2. 工作机制进一步完善  
3. 工作成效进一步显现

三、存在问题
在工作推进过程中，还存在一些需要关注和解决的问题。

四、下一步工作打算
1. 进一步加强组织领导
2. 进一步完善工作措施
3. 进一步强化督促检查

${notes ? `\n补充汇报：\n${notes}` : ''}

我们将以更高的标准、更严的要求，继续做好相关工作。

以上汇报，请领导指示。`,

        letter: `关于${topic}的函件

尊敬的xxx：

您好！

根据工作需要，现就${topic}相关事宜致函如下：

经认真研究，我们认为此事具有重要意义，需要双方加强沟通协调，共同推进相关工作。

具体建议：
1. 建立常态化沟通机制
2. 明确各自职责分工
3. 加强信息共享交流

${notes ? `\n补充说明：\n${notes}` : ''}

希望能够得到您的支持和配合。如有其他意见建议，请及时沟通。

此致
敬礼！

日期：${new Date().toLocaleDateString('zh-CN')}`
    };
    
    let content = templates[contentType] || templates.announcement;
    
    // 根据字数要求调整内容长度
    if (contentLength && contentLength < 300) {
        // 简化版本
        const lines = content.split('\n');
        content = lines.slice(0, Math.ceil(lines.length * 0.6)).join('\n');
    } else if (contentLength && contentLength > 800) {
        // 详细版本
        content += '\n\n我们要以高度的责任感和使命感，确保各项工作落实到位，不辜负组织的信任和期望。同时，要注重工作方法和效率，在保证质量的前提下，提高工作效率，确保按时完成各项任务。';
    }
    
    return content;
}

// 文件上传功能
function selectFiles() {
    document.getElementById('file-input').click();
}

document.getElementById('file-input').addEventListener('change', async function(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    // 检查API配置
    if (!API_CONFIG.OSS.accessKeyId) {
        showToast('请先配置OSS API信息', 'error');
        return;
    }
    
    appState.isUploading = true;
    updateUploadStatus('正在上传文件...');
    
    try {
        // 上传文件到OSS
        const fileUrls = await uploadFilesToOSS(files);
        
        // 添加文件到界面显示
        files.forEach((file, index) => {
            addFileToList(file.name, getFileType(file.name), formatFileSize(file.size));
            appState.uploadedFiles.push({
                name: file.name,
                type: getFileType(file.name),
                size: formatFileSize(file.size),
                url: fileUrls[index]
            });
        });
        
        // 保存文件URL到全局状态
        appState.fileUrls.push(...fileUrls);
        
        showToast(`成功上传 ${files.length} 个文件`, 'success');
        
        // 开始风格分析
        await performStyleAnalysis();
        
    } catch (error) {
        console.error('文件上传失败:', error);
        
        // 提供更详细的错误信息
        let errorMsg = '文件上传失败: ';
        if (error.message && error.message.includes('XMLHttpRequest')) {
            errorMsg += 'CORS跨域问题，请检查OSS跨域设置';
        } else if (error.status === 403) {
            errorMsg += '权限不足，请检查AccessKey权限';
        } else if (error.status === 404) {
            errorMsg += 'Bucket不存在，请检查配置';
        } else {
            errorMsg += error.message || '未知错误';
        }
        
        showToast(errorMsg, 'error');
        
        // 提供解决建议
        console.log('🔧 文件上传失败解决建议:');
        console.log('1. 确认CORS设置正确');
        console.log('2. 运行 diagnoseOSSIssues() 进行全面诊断');
        console.log('3. 检查文件大小是否超限');
        console.log('4. 检查网络连接');
    } finally {
        appState.isUploading = false;
        updateUploadStatus('');
    }
    
    e.target.value = ''; // 清空输入框
});

function addFileToList(filename, type, size) {
    const uploadedFiles = document.getElementById('uploaded-files');
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    fileItem.innerHTML = `
        <i class="fas fa-file-${type}"></i>
        <span class="filename">${filename}</span>
        <button class="remove-btn" onclick="removeFile(this)">
            <i class="fas fa-times"></i>
        </button>
    `;
    uploadedFiles.appendChild(fileItem);
}

function removeFile(button) {
    const fileItem = button.parentElement;
    const filename = fileItem.querySelector('.filename').textContent;
    
    // 从DOM移除
    fileItem.remove();
    
    // 从全局状态移除
    const fileIndex = appState.uploadedFiles.findIndex(file => file.name === filename);
    if (fileIndex > -1) {
        appState.uploadedFiles.splice(fileIndex, 1);
        appState.fileUrls.splice(fileIndex, 1);
    }
    
    updateAnalysisStatus();
}

function getFileType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    switch(ext) {
        case 'pdf': return 'pdf';
        case 'doc':
        case 'docx': return 'word';
        case 'txt': return 'alt';
        default: return 'alt';
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// URL 输入功能
function addUrlInput() {
    const urlInputs = document.getElementById('url-inputs');
    const urlItem = document.createElement('div');
    urlItem.className = 'url-item';
    urlItem.innerHTML = `
        <input type="url" class="url-input" placeholder="输入网页链接" onchange="saveUrl(this)">
        <button class="remove-btn" onclick="removeUrl(this)">
            <i class="fas fa-times"></i>
        </button>
    `;
    urlInputs.appendChild(urlItem);
    urlItem.querySelector('.url-input').focus();
}

function saveUrl(input) {
    const url = input.value.trim();
    if (url && isValidUrl(url)) {
        appState.urls.push(url);
        updateAnalysisStatus();
    }
}

function removeUrl(button) {
    const urlItem = button.parentElement;
    const url = urlItem.querySelector('.url-input').value;
    
    // 从DOM移除
    urlItem.remove();
    
    // 从全局状态移除
    appState.urls = appState.urls.filter(u => u !== url);
    updateAnalysisStatus();
}

function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// 执行风格分析
async function performStyleAnalysis() {
    if (appState.fileUrls.length === 0 && appState.urls.length === 0) {
        return;
    }
    
    appState.isAnalyzing = true;
    updateAnalysisStatus('正在分析风格...');
    
    try {
        // 合并文件URL和用户输入的URL
        const allUrls = [...appState.fileUrls, ...appState.urls];
        
        console.log('开始风格分析，文件URL:', allUrls);
        
        let styleOutput;
        
        // 根据配置的模式选择接口
        if (API_CONFIG.MODE === 'chat' && API_CONFIG.FASTGPT_CONTENT.apiKey) {
            // 使用对话接口
            console.log('🔄 使用对话接口进行风格分析');
            styleOutput = await analyzeStyleWithChat(allUrls);
        } else if (API_CONFIG.FASTGPT_STYLE.workflowId && API_CONFIG.FASTGPT_STYLE.apiKey) {
            // 使用工作流接口
            console.log('🔄 使用工作流接口进行风格分析');
            styleOutput = await callStyleAnalysisWorkflow(allUrls);
        } else {
            throw new Error('请配置FastGPT API密钥和工作流ID，或切换到对话模式');
        }
        
        appState.styleOutput = styleOutput;
        updateAnalysisStatus(`风格分析完成：${styleOutput}`);
        showToast('风格分析完成', 'success');
        
    } catch (error) {
        console.error('风格分析失败:', error);
        
        // 检查是否是API配置问题
        if (!API_CONFIG.FASTGPT_STYLE.apiKey || !API_CONFIG.FASTGPT_STYLE.workflowId) {
            console.warn('💡 FastGPT风格分析配置不完整');
            appState.styleOutput = '正式严谨，条理清晰，用词准确，逻辑性强';
            updateAnalysisStatus(`使用默认专业风格：${appState.styleOutput}`);
            if (!API_CONFIG.FASTGPT_STYLE.workflowId) {
                showToast('需要配置工作流ID，当前使用默认风格', 'info');
            } else {
                showToast('FastGPT未配置，使用默认专业风格', 'info');
            }
        } else if (error.message.includes('Key is error') || error.message.includes('app key')) {
            console.warn('💡 需要使用应用专用API密钥，不是账户密钥');
            appState.styleOutput = '正式严谨，条理清晰，用词准确，逻辑性强';
            updateAnalysisStatus(`需要应用密钥，使用专业风格：${appState.styleOutput}`);
            showToast('请使用应用专用API密钥。当前使用专业模板', 'warning');
        } else if (error.message.includes('CORS') || error.message.includes('blocked') || error.message.includes('Failed to fetch')) {
            console.warn('💡 CORS跨域限制或FastGPT服务连接问题');
            appState.styleOutput = '正式严谨，条理清晰，用词准确，逻辑性强';
            updateAnalysisStatus(`FastGPT连接受限，使用专业风格：${appState.styleOutput}`);
            showToast('FastGPT暂时无法连接，已启用专业模板模式', 'success');
        } else {
            console.warn('💡 API调用失败，使用默认风格');
            appState.styleOutput = '正式严谨，条理清晰，用词准确，逻辑性强';
            updateAnalysisStatus(`API异常，使用专业风格：${appState.styleOutput}`);
            showToast('使用专业模板风格，功能完全可用', 'success');
        }
    } finally {
        appState.isAnalyzing = false;
    }
}

// 更新分析状态显示
function updateAnalysisStatus(message = '') {
    const statusItems = document.querySelectorAll('.status-item span');
    if (statusItems.length >= 2) {
        if (message) {
            statusItems[0].textContent = message;
            statusItems[1].textContent = '';
        } else {
            const fileCount = appState.uploadedFiles.length;
            const urlCount = appState.urls.length;
            statusItems[0].textContent = `已分析 ${fileCount} 个文件，${urlCount} 个链接`;
            
            if (appState.styleOutput) {
                statusItems[1].textContent = `识别到语言风格：${appState.styleOutput}`;
            } else {
                statusItems[1].textContent = '等待风格分析...';
            }
        }
    }
}

function updateUploadStatus(message) {
    // 可以在这里添加上传状态的显示逻辑
    console.log('上传状态:', message);
}

// 表单验证
function validateForm() {
    const topic = document.getElementById('topic').value.trim();
    
    if (!topic) {
        showToast('请填写主题内容！', 'error');
        document.getElementById('topic').focus();
        return false;
    }
    
    // 如果没有风格分析结果，使用默认风格
    if (!appState.styleOutput) {
        appState.styleOutput = '正式严谨，条理清晰，用词准确';
        console.log('使用默认风格:', appState.styleOutput);
    }
    
    return true;
}

// 生成内容
async function generateContent() {
    if (!validateForm()) {
        return;
    }
    
    const topic = document.getElementById('topic').value.trim();
    const contentLength = parseInt(document.getElementById('word-count').value) || 500;
    const contentType = document.getElementById('content-type').value;
    const notes = document.getElementById('notes').value.trim();
    
    // 显示加载状态
    const generateBtn = document.querySelector('.generate-btn');
    const originalText = generateBtn.innerHTML;
    generateBtn.innerHTML = '<div class="loading"></div> 正在生成中...';
    generateBtn.disabled = true;
    
    appState.isGenerating = true;
    
    try {
        let generatedContent;
        
        // 根据配置的模式选择接口
        if (API_CONFIG.MODE === 'chat' && API_CONFIG.FASTGPT_CONTENT.apiKey) {
            // 使用对话接口
            console.log('🔄 使用对话接口进行内容生成');
            generatedContent = await generateContentWithChat(
                appState.styleOutput,
                contentLength,
                topic,
                contentType,
                notes
            );
        } else if (API_CONFIG.FASTGPT_CONTENT.workflowId && API_CONFIG.FASTGPT_CONTENT.apiKey) {
            // 使用工作流接口
            console.log('🔄 使用工作流接口进行内容生成');
            generatedContent = await callContentGenerationWorkflow(
                appState.styleOutput,
                contentLength,
                topic,
                contentType,
                notes
            );
        } else {
            throw new Error('请配置FastGPT API密钥和工作流ID，或切换到对话模式');
        }
        
        // 显示结果
        displayResult(generatedContent);
        
        // 保存到全局状态
        appState.generatedContent = generatedContent;
        
        // 滚动到结果区域
        document.getElementById('result-section').scrollIntoView({ 
            behavior: 'smooth' 
        });
        
        showToast('内容生成完成！', 'success');
        
    } catch (error) {
        console.error('FastGPT调用失败，使用本地模板生成:', error);
        
        // 使用本地模板作为备用方案
        const fallbackContent = generateFallbackContent(topic, contentType, contentLength, notes);
        
        // 显示结果
        displayResult(fallbackContent);
        
        // 保存到全局状态
        appState.generatedContent = fallbackContent;
        
        // 滚动到结果区域
        document.getElementById('result-section').scrollIntoView({ 
            behavior: 'smooth' 
        });
        
        showToast('内容生成完成（使用本地模板）', 'info');
    } finally {
        // 恢复按钮状态
        generateBtn.innerHTML = originalText;
        generateBtn.disabled = false;
        appState.isGenerating = false;
    }
}

function displayResult(content) {
    const resultSection = document.getElementById('result-section');
    const resultContent = document.getElementById('result-content');
    const wordCountDisplay = document.getElementById('word-count-display');
    const generationTime = document.getElementById('generation-time');
    
    resultContent.textContent = content;
    wordCountDisplay.textContent = `约 ${content.length} 字`;
    generationTime.textContent = new Date().toLocaleTimeString('zh-CN');
    
    resultSection.style.display = 'block';
}

// 复制结果
function copyResult() {
    const resultContent = document.getElementById('result-content').textContent;
    
    if (navigator.clipboard) {
        navigator.clipboard.writeText(resultContent).then(() => {
            showToast('内容已复制到剪贴板！', 'success');
        });
    } else {
        // 兼容旧浏览器
        const textArea = document.createElement('textarea');
        textArea.value = resultContent;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showToast('内容已复制到剪贴板！', 'success');
    }
}

// 编辑结果
function editResult() {
    const resultContent = document.getElementById('result-content');
    const currentContent = resultContent.textContent;
    
    // 创建编辑模式
    resultContent.innerHTML = `<textarea class="edit-textarea" style="width: 100%; height: 300px; border: none; outline: none; background: transparent; font-size: 1rem; line-height: 1.8; font-family: inherit; resize: vertical;">${currentContent}</textarea>`;
    
    const textarea = resultContent.querySelector('.edit-textarea');
    
    // 添加保存和取消按钮
    const editActions = document.createElement('div');
    editActions.style.marginTop = '15px';
    editActions.innerHTML = `
        <button class="action-btn" style="background: #28a745; color: white; margin-right: 10px;" onclick="saveEdit()">
            <i class="fas fa-save"></i> 保存修改
        </button>
        <button class="action-btn" style="background: #6c757d; color: white;" onclick="cancelEdit('${currentContent.replace(/'/g, "\\'")}')">
            <i class="fas fa-times"></i> 取消编辑
        </button>
    `;
    
    resultContent.appendChild(editActions);
    textarea.focus();
}

// 保存编辑
function saveEdit() {
    const resultContent = document.getElementById('result-content');
    const textarea = resultContent.querySelector('.edit-textarea');
    const newContent = textarea.value;
    
    // 更新显示和状态
    resultContent.innerHTML = newContent;
    appState.generatedContent = newContent;
    
    // 更新字数显示
    const wordCountDisplay = document.getElementById('word-count-display');
    wordCountDisplay.textContent = `约 ${newContent.length} 字`;
    
    showToast('内容已保存！', 'success');
}

// 取消编辑
function cancelEdit(originalContent) {
    const resultContent = document.getElementById('result-content');
    resultContent.textContent = originalContent;
}

// 重新生成
function regenerateContent() {
    if (confirm('确定要重新生成内容吗？当前内容将被覆盖。')) {
        generateContent();
    }
}

// 保存文档
function saveResult() {
    if (!appState.generatedContent) {
        showToast('没有可保存的内容！', 'error');
        return;
    }
    
    const topic = document.getElementById('topic').value.trim() || '生成内容';
    const contentType = document.getElementById('content-type').value;
    const filename = `${topic}_${contentType}_${new Date().toLocaleDateString('zh-CN')}.txt`;
    
    const blob = new Blob([appState.generatedContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('文档已保存！', 'success');
}

// 显示提示消息
function showToast(message, type = 'info') {
    // 移除已存在的提示
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }
    
    // 创建新提示
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // 3秒后自动移除
    setTimeout(() => {
        if (document.body.contains(toast)) {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (document.body.contains(toast)) {
                    document.body.removeChild(toast);
                }
            }, 300);
        }
    }, 3000);
}

// 拖拽上传功能
function setupDragDrop() {
    const uploadZone = document.getElementById('file-upload-zone');
    
    uploadZone.addEventListener('dragover', function(e) {
        e.preventDefault();
        uploadZone.style.borderColor = '#667eea';
        uploadZone.style.background = 'rgba(102, 126, 234, 0.1)';
    });
    
    uploadZone.addEventListener('dragleave', function(e) {
        e.preventDefault();
        uploadZone.style.borderColor = '#ccc';
        uploadZone.style.background = 'transparent';
    });
    
    uploadZone.addEventListener('drop', function(e) {
        e.preventDefault();
        uploadZone.style.borderColor = '#ccc';
        uploadZone.style.background = 'transparent';
        
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            // 模拟文件输入change事件
            const fileInput = document.getElementById('file-input');
            Object.defineProperty(fileInput, 'files', {
                value: files,
                writable: false,
            });
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    });
}

// API配置管理
function setAPIConfig(config) {
    Object.assign(API_CONFIG.OSS, config.OSS || {});
    Object.assign(API_CONFIG.FASTGPT_STYLE, config.FASTGPT_STYLE || {});
    Object.assign(API_CONFIG.FASTGPT_CONTENT, config.FASTGPT_CONTENT || {});
    
    // 重新初始化OSS客户端
    if (config.OSS) {
        initializeOSS();
    }
    
    console.log('API配置已更新');
}

// 检查配置并显示配置界面
function checkAPIConfig() {
    const hasStyleKey = API_CONFIG.FASTGPT_STYLE.apiKey;
    const hasContentKey = API_CONFIG.FASTGPT_CONTENT.apiKey;
    const hasStyleWorkflow = API_CONFIG.FASTGPT_STYLE.workflowId;
    const hasContentWorkflow = API_CONFIG.FASTGPT_CONTENT.workflowId;
    
    if (hasStyleKey && hasContentKey && hasStyleWorkflow && hasContentWorkflow) {
        console.log('✅ FastGPT配置完整');
        console.log('🎨 风格分析:', API_CONFIG.FASTGPT_STYLE.apiKey.substring(0, 20) + '... | 工作流:', hasStyleWorkflow);
        console.log('📝 内容生成:', API_CONFIG.FASTGPT_CONTENT.apiKey.substring(0, 20) + '... | 工作流:', hasContentWorkflow);
        return true;
    } else {
        console.log('💡 FastGPT配置不完整');
        if (!hasStyleKey) console.log('❌ 缺少风格分析密钥');
        if (!hasContentKey) console.log('❌ 缺少内容生成密钥');
        if (!hasStyleWorkflow) console.log('❌ 缺少风格分析工作流ID');
        if (!hasContentWorkflow) console.log('❌ 缺少内容生成工作流ID');
        console.log('💡 请获取您的工作流ID并配置');
        return false;
    }
}

// 显示配置模态框
function showConfigModal() {
    const modal = document.createElement('div');
    modal.className = 'config-modal';
    modal.innerHTML = `
        <div class="config-modal-content">
            <h3>🔧 API配置</h3>
            <p>请输入您的API配置信息以使用完整功能：</p>
            
            <div class="config-section">
                <h4>阿里云OSS配置</h4>
                <input type="text" id="oss-key-id" placeholder="AccessKey ID" value="${API_CONFIG.OSS.accessKeyId}">
                <input type="password" id="oss-key-secret" placeholder="AccessKey Secret" value="${API_CONFIG.OSS.accessKeySecret}">
            </div>
            
            <div class="config-section">
                <h4>FastGPT配置</h4>
                <input type="password" id="fastgpt-style-key" placeholder="风格分析API Key" value="${API_CONFIG.FASTGPT_STYLE.apiKey}">
                <input type="password" id="fastgpt-content-key" placeholder="内容生成API Key" value="${API_CONFIG.FASTGPT_CONTENT.apiKey}">
            </div>
            
            <div class="config-buttons">
                <button onclick="saveAPIConfig()">保存配置</button>
                <button onclick="skipConfig()">跳过（使用模板模式）</button>
            </div>
            
            <div class="config-help">
                <p><small>💡 这些信息只会保存在您的浏览器本地，不会上传到服务器</small></p>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// 保存API配置
function saveAPIConfig() {
    const ossKeyId = document.getElementById('oss-key-id').value.trim();
    const ossKeySecret = document.getElementById('oss-key-secret').value.trim();
    const fastgptStyleKey = document.getElementById('fastgpt-style-key').value.trim();
    const fastgptContentKey = document.getElementById('fastgpt-content-key').value.trim();
    
    if (ossKeyId && ossKeySecret && fastgptStyleKey && fastgptContentKey) {
        API_CONFIG.OSS.accessKeyId = ossKeyId;
        API_CONFIG.OSS.accessKeySecret = ossKeySecret;
        API_CONFIG.FASTGPT_STYLE.apiKey = fastgptStyleKey;
        API_CONFIG.FASTGPT_CONTENT.apiKey = fastgptContentKey;
        
        // 保存到本地存储
        localStorage.setItem('boss_kb_config', JSON.stringify(API_CONFIG));
        
        // 关闭配置窗口
        document.querySelector('.config-modal').remove();
        
        // 初始化OSS
        initializeOSS();
        
        showToast('配置保存成功！', 'success');
    } else {
        showToast('请填写完整的配置信息', 'error');
    }
}

// 跳过配置
function skipConfig() {
    document.querySelector('.config-modal').remove();
    showToast('使用模板模式，部分功能受限', 'info');
}

// 从本地存储加载配置
function loadConfigFromStorage() {
    const saved = localStorage.getItem('boss_kb_config');
    if (saved) {
        try {
            const config = JSON.parse(saved);
            API_CONFIG = { ...API_CONFIG, ...config };
        } catch (e) {
            console.error('配置加载失败:', e);
        }
    }
}

// 简化初始化检查
async function checkAPIConnection() {
    if (API_CONFIG.FASTGPT_CONTENT.apiKey) {
        console.log('✅ 检测到API密钥，可以开始使用');
        showToast('系统已就绪，可以开始使用FastGPT功能', 'success');
        return true;
    } else {
        console.log('💡 请配置API密钥开始使用');
        showToast('请在控制台配置API密钥：setApiKey("你的密钥")', 'info');
        return false;
    }
}



// 页面加载完成后的初始化
document.addEventListener('DOMContentLoaded', async function() {
    // 从本地存储加载配置
    loadConfigFromStorage();
    
    // 设置默认风格，确保系统始终可用
    appState.styleOutput = '正式严谨，条理清晰，用词准确，逻辑性强，表达规范';
    
    // 检查API连接状态
    await checkAPIConnection();
    
    // 检查配置并初始化
    checkAPIConfig();
    
    // 初始化OSS客户端（如果配置了）
    if (API_CONFIG.OSS.accessKeyId && API_CONFIG.OSS.accessKeySecret) {
        try {
            await initializeOSS();
        } catch (error) {
            console.error('OSS初始化失败:', error);
        }
    }
    
    // 设置拖拽上传
    setupDragDrop();
    
    // 初始化分析状态
    updateAnalysisStatus('系统已就绪！可直接生成内容，或配置API使用高级功能');
    
    // 添加快捷键支持
    document.addEventListener('keydown', function(e) {
        // Ctrl+Enter 快速生成
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            generateContent();
        }
        
        // Ctrl+S 保存文档
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            if (appState.generatedContent) {
                saveResult();
            }
        }
    });
    
    // 实时保存表单数据到本地存储
    const inputs = document.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        input.addEventListener('change', function() {
            localStorage.setItem(`boss-kb-${input.id}`, input.value);
        });
        
        // 加载保存的数据
        const saved = localStorage.getItem(`boss-kb-${input.id}`);
        if (saved && input.id !== 'file-input') {
            input.value = saved;
        }
    });
    
    // 显示欢迎信息和配置提示
    setTimeout(() => {
        const hasStyleKey = API_CONFIG.FASTGPT_STYLE.apiKey;
        const hasContentKey = API_CONFIG.FASTGPT_CONTENT.apiKey;
        const hasStyleWorkflow = API_CONFIG.FASTGPT_STYLE.workflowId;
        const hasContentWorkflow = API_CONFIG.FASTGPT_CONTENT.workflowId;
        
        if (hasStyleKey && hasContentKey && hasStyleWorkflow && hasContentWorkflow) {
            showToast('老板专属知识库已就绪！FastGPT工作流已配置，功能完整', 'success');
        } else {
            showToast('老板专属知识库已就绪！可直接使用模板，或配置FastGPT工作流获得AI功能', 'info');
            
            // 详细配置提示
            console.log('💡 当前配置状态:');
            console.log(`  风格分析密钥: ${hasStyleKey ? '✅' : '❌'}`);
            console.log(`  内容生成密钥: ${hasContentKey ? '✅' : '❌'}`);
            console.log(`  风格分析工作流: ${hasStyleWorkflow ? '✅' : '❌'}`);
            console.log(`  内容生成工作流: ${hasContentWorkflow ? '✅' : '❌'}`);
            console.log('💡 查看完整配置: showConfig()');
        }
    }, 2000);
});

// 导出配置函数供外部调用
window.setAPIConfig = setAPIConfig;

// 快速配置FastGPT API密钥
window.setStyleKey = function(apiKey) {
    API_CONFIG.FASTGPT_STYLE.apiKey = apiKey;
    localStorage.setItem('boss_kb_config', JSON.stringify(API_CONFIG));
    console.log('✅ FastGPT风格分析密钥已更新');
    console.log('API Key:', apiKey ? apiKey.substring(0, 20) + '...' : '未配置');
    showToast('风格分析API配置成功', 'success');
};

window.setContentKey = function(apiKey) {
    API_CONFIG.FASTGPT_CONTENT.apiKey = apiKey;
    localStorage.setItem('boss_kb_config', JSON.stringify(API_CONFIG));
    console.log('✅ FastGPT内容生成密钥已更新');
    console.log('API Key:', apiKey ? apiKey.substring(0, 20) + '...' : '未配置');
    showToast('内容生成API配置成功', 'success');
};

// 配置工作流ID
window.setStyleWorkflowId = function(workflowId) {
    API_CONFIG.FASTGPT_STYLE.workflowId = workflowId;
    localStorage.setItem('boss_kb_config', JSON.stringify(API_CONFIG));
    console.log('✅ 风格分析工作流ID已更新');
    console.log('Workflow ID:', workflowId);
    showToast('风格分析工作流配置成功', 'success');
};

window.setContentWorkflowId = function(workflowId) {
    API_CONFIG.FASTGPT_CONTENT.workflowId = workflowId;
    localStorage.setItem('boss_kb_config', JSON.stringify(API_CONFIG));
    console.log('✅ 内容生成工作流ID已更新');
    console.log('Workflow ID:', workflowId);
    showToast('内容生成工作流配置成功', 'success');
};

// 显示当前配置
window.showConfig = function() {
    console.log('=== 当前FastGPT配置 ===');
    console.log('🔧 接口模式:', API_CONFIG.MODE === 'chat' ? '对话接口模式' : '工作流接口模式');
    console.log('🎨 风格分析配置:');
    console.log('  API Key:', API_CONFIG.FASTGPT_STYLE.apiKey ? API_CONFIG.FASTGPT_STYLE.apiKey.substring(0, 20) + '...' : '❌ 未配置');
    console.log('  Workflow ID:', API_CONFIG.FASTGPT_STYLE.workflowId || '❌ 未配置');
    console.log('📝 内容生成配置:');
    console.log('  API Key:', API_CONFIG.FASTGPT_CONTENT.apiKey ? API_CONFIG.FASTGPT_CONTENT.apiKey.substring(0, 20) + '...' : '❌ 未配置');
    console.log('  Workflow ID:', API_CONFIG.FASTGPT_CONTENT.workflowId || '❌ 未配置');
    console.log('🌐 API地址:', API_CONFIG.FASTGPT_CONTENT.baseUrl);
    console.log('========================');
    
    // 配置提示
    console.log('💡 快速配置命令:');
    console.log('  设置API密钥: setApiKey("fastgpt-你的密钥")');
    console.log('  切换到对话模式: setMode("chat")');
    console.log('  切换到工作流模式: setMode("workflow")');
    if (!API_CONFIG.FASTGPT_STYLE.workflowId) {
        console.log('  配置风格分析工作流: setStyleWorkflowId("您的工作流ID")');
    }
    if (!API_CONFIG.FASTGPT_CONTENT.workflowId) {
        console.log('  配置内容生成工作流: setContentWorkflowId("您的工作流ID")');
    }
    console.log('  测试API连接: testApi()');
};

// 新增：设置接口模式
window.setMode = function(mode) {
    if (mode !== 'chat' && mode !== 'workflow') {
        console.error('❌ 模式必须是 "chat" 或 "workflow"');
        return;
    }
    
    API_CONFIG.MODE = mode;
    localStorage.setItem('boss_kb_config', JSON.stringify(API_CONFIG));
    
    console.log(`✅ 接口模式已切换为: ${mode === 'chat' ? '对话接口模式' : '工作流接口模式'}`);
    
    if (mode === 'chat') {
        console.log('💡 对话模式说明:');
        console.log('  - 使用 /v1/chat/completions 接口');
        console.log('  - 需要应用专用API密钥');
        console.log('  - 适合简单的对话和内容生成');
        console.log('  - 设置密钥: setApiKey("fastgpt-你的应用密钥")');
    } else {
        console.log('💡 工作流模式说明:');
        console.log('  - 使用 /workflow/run 接口');
        console.log('  - 需要配置工作流ID');
        console.log('  - 适合复杂的文档分析和内容生成');
        console.log('  - 配置工作流: setStyleWorkflowId() 和 setContentWorkflowId()');
    }
    
    showToast(`已切换到${mode === 'chat' ? '对话' : '工作流'}接口模式`, 'success');
};

// 新增：统一设置API密钥（同时设置风格分析和内容生成）
window.setApiKey = function(apiKey) {
    if (!apiKey || !apiKey.startsWith('fastgpt-')) {
        console.error('❌ API密钥格式错误，应以 "fastgpt-" 开头');
        return;
    }
    
    API_CONFIG.FASTGPT_STYLE.apiKey = apiKey;
    API_CONFIG.FASTGPT_CONTENT.apiKey = apiKey;
    localStorage.setItem('boss_kb_config', JSON.stringify(API_CONFIG));
    
    console.log('✅ FastGPT API密钥已设置');
    console.log('API Key:', apiKey.substring(0, 20) + '...');
    showToast('FastGPT API密钥配置成功', 'success');
    
    // 如果是对话模式，提示可以直接使用
    if (API_CONFIG.MODE === 'chat') {
        console.log('💡 当前为对话模式，可以直接使用！');
        showToast('对话模式已就绪，可以开始生成内容', 'info');
    }
};

// 新增：测试API连接 - 直接按照官方示例调用
window.testApi = async function() {
    console.log('🔄 测试FastGPT API连接...');
    
    if (!API_CONFIG.FASTGPT_CONTENT.apiKey) {
        console.error('❌ 请先配置API密钥: setApiKey("fastgpt-你的密钥")');
        return;
    }
    
    try {
        console.log('📡 API配置:');
        console.log('  URL:', `${API_CONFIG.FASTGPT_CONTENT.baseUrl}/v1/chat/completions`);
        console.log('  API Key:', API_CONFIG.FASTGPT_CONTENT.apiKey.substring(0, 20) + '...');
        
        // 完全按照官方示例的格式调用
        const requestBody = {
            "chatId": "111",
            "stream": false,
            "detail": false,
            "messages": [
                {
                    "content": "测试连接，请回复：连接成功",
                    "role": "user"
                }
            ]
        };
        
        console.log('📤 请求数据:', requestBody);
        
        const response = await fetch(`${API_CONFIG.FASTGPT_CONTENT.baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_CONFIG.FASTGPT_CONTENT.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        console.log('📥 响应状态:', response.status, response.statusText);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ API错误响应:', errorText);
            throw new Error(`API调用失败: ${response.status} - ${errorText}`);
        }
        
        const result = await response.json();
        console.log('✅ API响应成功:', result);
        
        if (result && result.choices && result.choices[0] && result.choices[0].message) {
            console.log('💬 AI回复:', result.choices[0].message.content);
            showToast('FastGPT API连接成功！', 'success');
        } else {
            console.warn('⚠️ 响应格式异常:', result);
            showToast('API连接成功但响应格式异常', 'warning');
        }
        
    } catch (error) {
        console.error('❌ API测试失败:', error);
        
        if (error.message.includes('Key is error')) {
            console.log('💡 错误原因: 使用了错误的密钥类型');
            console.log('📌 解决方案: 请使用应用专用密钥，不是账户密钥');
            showToast('API密钥类型错误，请使用应用专用密钥', 'error');
        } else if (error.message.includes('CORS')) {
            console.log('💡 错误原因: CORS跨域限制');
            console.log('📌 解决方案: 这确实需要代理服务器');
            showToast('遇到CORS跨域限制，需要代理服务器', 'error');
        } else {
            showToast('API测试失败: ' + error.message, 'error');
        }
    }
};

// 新增：快速配置指南
window.quickSetup = function() {
    console.log('=== FastGPT 快速配置指南 ===');
    console.log('');
    console.log('🎯 简单配置（对话接口）');
    console.log('1. 获取应用专用API密钥');
    console.log('2. setApiKey("fastgpt-你的应用密钥")');
    console.log('3. testApi() // 测试连接');
    console.log('');
    console.log('🎯 高级配置（工作流接口）');
    console.log('1. setMode("workflow")');
    console.log('2. setApiKey("fastgpt-你的密钥")');
    console.log('3. setStyleWorkflowId("风格分析工作流ID")');
    console.log('4. setContentWorkflowId("内容生成工作流ID")');
    console.log('');
    console.log('🔧 常用命令:');
    console.log('- showConfig() // 查看当前配置');
    console.log('- testApi() // 测试API连接');
    console.log('');
    console.log('📋 API密钥获取位置:');
    console.log('👉 登录FastGPT → 我的应用 → 选择应用 → API密钥');
    console.log('⚠️ 注意：使用应用专用密钥，不是账户密钥');
    console.log('===========================');
};

 