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
        workflowId: '685f87df49b71f158b57ae61' // 风格分析工作流ID（已修正）
    },
    // FastGPT配置 - 内容生成
    FASTGPT_CONTENT: {
        baseUrl: 'https://api.fastgpt.in/api', // FastGPT官方API地址
        apiKey: 'fastgpt-p2WSK5LRZZM3tVzk0XRT4vERkQ2PYLXi6rFAZdHzzuB7mSicDLRBXiymej', // 内容生成专用密钥
        workflowId: '685c9d7e6adb97a0858caaa6' // 内容创作工作流ID（已修正）
    },
    // 接口模式选择：'workflow' 或 'chat'
    MODE: 'chat' // 固定使用对话接口模式
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
        console.warn('⚠️ OSS配置不完整，文件上传功能将不可用');
        console.warn('💡 提示：如需使用文件上传功能，请在配置中填写OSS AccessKey信息');
        showToast('OSS配置不完整，文件上传功能暂时不可用', 'warning');
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
        showToast('OSS初始化失败，文件上传功能暂时不可用', 'warning');
        // 不要抛出错误，让应用继续运行
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
        throw new Error('OSS未正确配置。请在配置中填写正确的OSS AccessKey信息后重试。');
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
            
            // 提供更详细的错误信息
            if (error.name === 'SignatureDoesNotMatchError') {
                throw new Error(`文件 ${file.name} 上传失败：OSS签名验证失败，请检查AccessKey配置是否正确`);
            } else if (error.status === 403) {
                throw new Error(`文件 ${file.name} 上传失败：OSS权限不足，请检查AccessKey权限设置`);
            } else if (error.status === 404) {
                throw new Error(`文件 ${file.name} 上传失败：OSS Bucket不存在，请检查Bucket名称`);
            } else {
                throw new Error(`文件 ${file.name} 上传失败: ${error.message}`);
            }
        }
    }
    
    return uploadResults;
}

// 调用FastGPT工作流接口（风格分析）
async function callStyleAnalysisWorkflow(fileUrls, userUrls) {
    // 保证参数为数组
    const safeFileUrls = Array.isArray(fileUrls) ? fileUrls : [];
    const safeUserUrls = Array.isArray(userUrls) ? userUrls : [];
    console.log('🔄 调用FastGPT风格分析工作流...');
    console.log('文件URLs:', safeFileUrls);
    console.log('用户URLs:', safeUserUrls);
    if (!API_CONFIG.FASTGPT_STYLE.workflowId) {
        throw new Error('风格分析工作流ID未配置，请先配置workflowId');
    }
    const response = await fetch(`/api/fastgpt/workflow/run`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_CONFIG.FASTGPT_STYLE.apiKey}`
        },
        body: JSON.stringify({
            workflowId: API_CONFIG.FASTGPT_STYLE.workflowId,
            variables: {
                article_input: safeFileUrls,  // 文件URL数组
                url_input: safeUserUrls      // 用户输入URL数组
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
    
    // 详细调试响应结构
    console.log('🔍 调试 - 响应结构分析:');
    console.log('- result类型:', typeof result);
    console.log('- result键名:', Object.keys(result || {}));
    
    if (result && result.data) {
        console.log('- result.data类型:', typeof result.data);
        console.log('- result.data键名:', Object.keys(result.data || {}));
    }
    
    // 尝试多种可能的路径提取style_output
    let styleOutput = null;
    
    if (result && result.style_output) {
        console.log('✓ 在 result.style_output 找到内容');
        styleOutput = result.style_output;
    } else if (result && result.data && result.data.style_output) {
        console.log('✓ 在 result.data.style_output 找到内容');
        styleOutput = result.data.style_output;
    } else if (result && result.outputs && result.outputs.style_output) {
        console.log('✓ 在 result.outputs.style_output 找到内容');
        styleOutput = result.outputs.style_output;
    } else if (result && result.variables && result.variables.style_output) {
        console.log('✓ 在 result.variables.style_output 找到内容');
        styleOutput = result.variables.style_output;
    } else {
        console.warn('❌ 在所有预期路径都未找到style_output变量');
        console.log('🔍 完整响应内容:', JSON.stringify(result, null, 2));
        
        // 尝试返回整个结果让用户看到实际结构
        throw new Error('无法找到style_output变量，请检查工作流输出配置');
    }
    
    console.log('✅ 提取到的style_output内容:', styleOutput);
    return styleOutput;
}



// 调用FastGPT工作流接口（内容生成）
async function callContentGenerationWorkflow(styleOutput, contentLength, topic, styleType, remark) {
    console.log('🔄 调用FastGPT内容生成工作流...');
    console.log('参数:', { styleOutput, contentLength, topic, styleType, remark });
    
    if (!API_CONFIG.FASTGPT_CONTENT.workflowId) {
        throw new Error('内容生成工作流ID未配置，请先配置workflowId');
    }
    
    const response = await fetch(`/api/fastgpt/workflow/run`, {
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

// 新增：FastGPT 对话接口调用（支持自定义API密钥和workflowId）
async function callChatCompletions(messages, customUid = null, variables = null, apiKey = null, workflowId = null) {
    console.log('🔄 调用FastGPT对话接口...');
    console.log('消息:', messages);
    console.log('变量:', variables);
    
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
    
    // 如果提供了variables，添加到请求中
    if (variables) {
        requestBody.variables = variables;
    }
    // 如果提供了workflowId，添加到请求中（FastGPT官方支持）
    if (workflowId) {
        requestBody.workflowId = workflowId;
    }
    
    const response = await fetch(`/api/fastgpt/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey || API_CONFIG.FASTGPT_CONTENT.apiKey}`
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

// 新增：使用对话接口进行风格分析（只传递空内容的user message和变量）
async function analyzeStyleWithChat(article_input, url_input) {
    // 保证参数为数组
    const safeArticleInput = Array.isArray(article_input) ? article_input : [];
    const safeUrlInput = Array.isArray(url_input) ? url_input : [];
    // 传递一个空内容的user message，避免接口报错
    const messages = [
        { role: 'user', content: '' }
    ];
    const variables = {
        article_input: safeArticleInput,
        url_input: safeUrlInput
    };
    return await callChatCompletions(messages, null, variables, API_CONFIG.FASTGPT_STYLE.apiKey, API_CONFIG.FASTGPT_STYLE.workflowId);
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
        'formal_speech': '正式发言稿',
        'casual_speech': '随性讲话稿',
        'work_email': '工作邮件',
        'default': '按文章风格输出'
    };
    return typeMap[type] || '文档';
}

// 本地备用内容生成
function generateFallbackContent(topic, contentType, contentLength, notes) {
    const templates = {
        formal_speech: `各位同事：

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

        casual_speech: `大家好！

今天想和大家聊聊"${topic}"这个话题。

说实话，这个事情挺重要的，我觉得咱们得好好琢磨琢磨。我的想法是这样的：

首先，咱们得把这事儿看重了。${topic}虽然看起来可能不起眼，但实际上挺关键的，关系到咱们后面的发展。

然后呢，咱们得想想怎么做。我觉得可以这样：大家先各自梳理一下手头的事情，看看哪些和这个相关，然后咱们再一起讨论讨论。

${notes ? `\n顺便说一下：\n${notes}` : ''}

总的来说，这事儿不复杂，关键是大家一起努力，我相信肯定能搞定的。

谢谢大家！`,

        work_email: `各位同事：

关于"${topic}"事宜，现将相关安排通知如下：

根据工作需要和实际情况，经研究决定，就此项工作做出如下安排：

1. 各部门要高度重视，认真组织实施
2. 严格按照时间节点，确保各项工作按时完成
3. 加强沟通协调，及时解决工作中遇到的问题

${notes ? `\n特别说明：\n${notes}` : ''}

请各位同事务必按照要求抓好落实。如有疑问，请及时与我联系。

此致
敬礼！`,

        default: `关于${topic}

${topic}是当前需要重点关注和推进的重要工作。通过深入分析研究，现就相关事项说明如下：

一、基本情况
${topic}涉及多个方面，需要统筹考虑，协调推进。

二、主要措施
1. 明确工作目标和时间节点
2. 强化责任分工和协调配合
3. 确保各项工作落实到位

${notes ? `\n备注：\n${notes}` : ''}

以上内容请各相关方面认真执行，确保工作顺利推进。`,


    };
    
    let content = templates[contentType] || templates.default;
    
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
    // 检查OSS是否已配置
    if (!API_CONFIG.OSS.accessKeyId || !API_CONFIG.OSS.accessKeySecret) {
        showToast('请先配置OSS访问凭证才能使用文件上传功能', 'warning');
        return;
    }
    
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.txt,.md,.doc,.docx,.pdf,.json,.csv,.xml,.html,.htm,.js,.css,.py,.java,.cpp,.c,.php,.rb,.go,.rs,.swift,.kt,.tsx,.ts,.jsx,.vue,.scss,.sass,.less,.styl,.yml,.yaml,.toml,.ini,.conf,.log,.sql,.sh,.bat,.ps1,.tex,.rtf,.odt,.ods,.odp,.epub,.mobi,.azw3';
    
    input.onchange = async function(event) {
        const files = Array.from(event.target.files);
        if (files.length === 0) return;
        
        // 检查文件大小
        const maxSize = 10 * 1024 * 1024; // 10MB
        const oversizedFiles = files.filter(file => file.size > maxSize);
        if (oversizedFiles.length > 0) {
            showToast(`文件过大：${oversizedFiles.map(f => f.name).join(', ')}（限制10MB）`, 'error');
            return;
        }
        
        // 显示上传状态
        appState.isUploading = true;
        updateUploadStatus('正在上传文件...');
        
        try {
            // 上传文件到OSS
            const fileUrls = await uploadFilesToOSS(files);
            
            // 上传成功后处理
            files.forEach((file, index) => {
                // 添加到页面显示
                addFileToList(file.name, getFileType(file.name), file.size);
                
                // 添加到全局状态
                appState.uploadedFiles.push({
                    name: file.name,
                    type: getFileType(file.name),
                    size: file.size,
                    url: fileUrls[index]
                });
            });
            
            // 更新文件URL数组
            appState.fileUrls.push(...fileUrls);
            
            // 显示成功提示
            showToast(`✅ 成功上传 ${files.length} 个文件`, 'success');
            
            // 更新按钮状态
            checkLearningButtonStatus();
            
            // 更新分析状态
            updateAnalysisStatus(`已上传 ${appState.uploadedFiles.length} 个文件，${appState.urls.length} 个链接。可继续添加或点击"开始AI学习"`);
            
            console.log('✅ 文件上传完成');
            console.log('- 上传文件数:', files.length);
            console.log('- 文件URL数组:', appState.fileUrls);
            console.log('- 总文件数:', appState.uploadedFiles.length);
            
        } catch (error) {
            console.error('文件上传失败:', error);
            
            // 显示详细错误信息
            let errorMsg = '文件上传失败: ';
            if (error.message.includes('OSS签名验证失败')) {
                errorMsg += 'OSS签名验证失败，请检查AccessKey配置';
            } else if (error.message.includes('OSS权限不足')) {
                errorMsg += 'OSS权限不足，请检查AccessKey权限设置';
            } else if (error.message.includes('Bucket不存在')) {
                errorMsg += 'OSS Bucket不存在，请检查Bucket名称';
            } else if (error.message.includes('XMLHttpRequest')) {
                errorMsg += 'CORS跨域问题，请检查OSS跨域设置';
            } else {
                errorMsg += error.message || '未知错误';
            }
            
            showToast(errorMsg, 'error');
        } finally {
            appState.isUploading = false;
            updateUploadStatus('');
        }
    };
    
    input.click();
}

// 文件上传处理已移至selectFiles()函数，避免重复处理

function addFileToList(filename, type, size) {
    const uploadedFiles = document.getElementById('uploaded-files');
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    
    // 如果size是数字，需要格式化
    const formattedSize = typeof size === 'number' ? formatFileSize(size) : size;
    
    fileItem.innerHTML = `
        <i class="fas fa-file-${type}"></i>
        <span class="filename">${filename}</span>
        <span class="filesize">${formattedSize}</span>
        <button class="remove-btn" onclick="removeFile(this)">
            <i class="fas fa-times"></i>
        </button>
    `;
    uploadedFiles.appendChild(fileItem);
    
    // 检查是否可以启用AI学习按钮
    checkLearningButtonStatus();
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
    checkLearningButtonStatus();
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
        checkLearningButtonStatus();
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
    checkLearningButtonStatus();
}

function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// 检查AI学习按钮状态
function checkLearningButtonStatus() {
    const learningBtn = document.getElementById('start-learning-btn');
    if (!learningBtn) return;
    
    const hasFiles = appState.uploadedFiles.length > 0;
    const hasUrls = appState.urls.length > 0;
    const hasContent = hasFiles || hasUrls;
    
    if (hasContent && !appState.isAnalyzing) {
        learningBtn.disabled = false;
        learningBtn.innerHTML = '<i class="fas fa-brain"></i> 开始AI学习';
    } else if (appState.isAnalyzing) {
        learningBtn.disabled = true;
        learningBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在学习中...';
    } else {
        learningBtn.disabled = true;
        learningBtn.innerHTML = '<i class="fas fa-brain"></i> 开始AI学习';
    }
}

// 新增：收集所有URL输入框内容，确保全部加入appState.urls
function collectAllUrls() {
    const urlInputs = document.querySelectorAll('.url-input');
    const urls = [];
    urlInputs.forEach(input => {
        input.blur(); // 强制失去焦点，确保onchange被触发
        const url = input.value.trim();
        if (url && isValidUrl(url)) {
            urls.push(url);
        }
    });
    appState.urls = urls.filter(Boolean); // 只保留非空字符串
    console.log('收集到的链接:', appState.urls);
}

// 执行风格分析（只在按钮点击时触发，变量名严格一致，始终传递数组）
async function performStyleAnalysis() {
    // 自动收集所有输入框内容，防止遗漏
    collectAllUrls();
    // 保证全局状态为数组
    if (!Array.isArray(appState.fileUrls)) appState.fileUrls = [];
    if (!Array.isArray(appState.urls)) appState.urls = [];
    const article_input = Array.isArray(appState.fileUrls) ? [...appState.fileUrls] : [];
    const url_input = Array.isArray(appState.urls) ? [...appState.urls] : [];
    if (article_input.length === 0 && url_input.length === 0) {
        showToast('请先上传文件或添加链接', 'info');
        return;
    }
    appState.isAnalyzing = true;
    updateAnalysisStatus('正在分析风格...');
    checkLearningButtonStatus();
    try {
        let styleOutput;
        if (API_CONFIG.MODE === 'chat') {
            if (!API_CONFIG.FASTGPT_STYLE.apiKey) {
                throw new Error('对话模式需要配置风格分析API密钥');
            }
            styleOutput = await analyzeStyleWithChat(article_input, url_input);
        } else if (API_CONFIG.MODE === 'workflow') {
            if (!API_CONFIG.FASTGPT_STYLE.workflowId || !API_CONFIG.FASTGPT_STYLE.apiKey) {
                throw new Error('工作流模式需要配置API密钥和工作流ID');
            }
            styleOutput = await callStyleAnalysisWorkflow(article_input, url_input);
        } else {
            throw new Error('请设置正确的接口模式（chat 或 workflow）');
        }
        appState.styleOutput = styleOutput;
        updateAnalysisStatus(); // 只展示风格分析结果
        showToast('风格分析完成', 'success');
    } catch (error) {
        console.error('风格分析失败:', error);
        appState.styleOutput = '正式严谨，条理清晰，用词准确，逻辑性强';
        updateAnalysisStatus();
        showToast('风格分析失败，已使用默认风格', 'warning');
    } finally {
        appState.isAnalyzing = false;
        checkLearningButtonStatus();
    }
}

// 只展示风格分析结果
function updateAnalysisStatus(message = '') {
    const statusItems = document.querySelectorAll('.status-item span');
    if (statusItems.length >= 2) {
        if (message) {
            statusItems[0].textContent = message;
            statusItems[1].textContent = '';
        } else {
            if (appState.styleOutput) {
                statusItems[0].textContent = `风格分析结果：${appState.styleOutput}`;
                statusItems[1].textContent = '';
            } else {
                statusItems[0].textContent = '等待风格分析...';
                statusItems[1].textContent = '';
            }
        }
    }
}

function updateUploadStatus(message) {
    // 在页面上显示上传状态
    const statusItems = document.querySelectorAll('.status-item span');
    if (statusItems.length >= 2) {
        if (message) {
            statusItems[1].textContent = message;
        } else {
            statusItems[1].textContent = '';
        }
    }
    
    // 同时在控制台输出状态
    if (message) {
        console.log('📤 上传状态:', message);
    }
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
        if (API_CONFIG.MODE === 'chat') {
            // 使用对话接口
            if (!API_CONFIG.FASTGPT_CONTENT.apiKey) {
                throw new Error('对话模式需要配置API密钥');
            }
            console.log('🔄 使用对话接口进行内容生成');
            generatedContent = await generateContentWithChat(
                appState.styleOutput,
                contentLength,
                topic,
                contentType,
                notes
            );
        } else if (API_CONFIG.MODE === 'workflow') {
            // 使用工作流接口
            if (!API_CONFIG.FASTGPT_CONTENT.workflowId || !API_CONFIG.FASTGPT_CONTENT.apiKey) {
                throw new Error('工作流模式需要配置API密钥和工作流ID');
            }
            console.log('🔄 使用工作流接口进行内容生成');
            generatedContent = await callContentGenerationWorkflow(
                appState.styleOutput,
                contentLength,
                topic,
                contentType,
                notes
            );
        } else {
            throw new Error('请设置正确的接口模式（chat 或 workflow）');
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
window.showConfigModal = function() {
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
                <button onclick="window.saveAPIConfig()">保存配置</button>
                <button onclick="window.skipConfig()">跳过（使用模板模式）</button>
            </div>
            
            <div class="config-help">
                <p><small>💡 这些信息只会保存在您的浏览器本地，不会上传到服务器</small></p>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// 保存API配置
window.saveAPIConfig = function() {
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
window.skipConfig = function() {
    document.querySelector('.config-modal').remove();
    showToast('使用模板模式，部分功能受限', 'info');
}

// 从本地存储加载配置
function loadConfigFromStorage() {
    // 保存代码中的关键配置
    const codeDefaults = {
        MODE: API_CONFIG.MODE,
        FASTGPT_STYLE: { ...API_CONFIG.FASTGPT_STYLE },
        FASTGPT_CONTENT: { ...API_CONFIG.FASTGPT_CONTENT }
    };
    
    const saved = localStorage.getItem('boss_kb_config');
    if (saved) {
        try {
            const config = JSON.parse(saved);
            API_CONFIG = { ...API_CONFIG, ...config };
            
            // 强制保持代码中的关键配置
            API_CONFIG.MODE = codeDefaults.MODE;
            API_CONFIG.FASTGPT_STYLE.workflowId = codeDefaults.FASTGPT_STYLE.workflowId;
            API_CONFIG.FASTGPT_CONTENT.workflowId = codeDefaults.FASTGPT_CONTENT.workflowId;
            
            console.log('✅ 配置已加载，但关键配置保持代码中的设置');
            console.log(`🔧 接口模式: ${API_CONFIG.MODE} (代码锁定)`);
            console.log(`🔧 风格分析工作流: ${API_CONFIG.FASTGPT_STYLE.workflowId} (代码锁定)`);
            console.log(`🔧 内容生成工作流: ${API_CONFIG.FASTGPT_CONTENT.workflowId} (代码锁定)`);
        } catch (e) {
            console.error('配置加载失败:', e);
        }
    } else {
        console.log('✅ 使用代码中的默认配置');
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
    
    // 初始化AI学习按钮状态
    checkLearningButtonStatus();
    
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

// 新增：显示配置锁定说明
window.showLocks = function() {
    console.log('🔒 ======== 配置锁定说明 ========');
    console.log('');
    console.log('✅ 以下配置已在代码中锁定，重启项目后自动生效：');
    console.log(`🔧 接口模式: ${API_CONFIG.MODE}`);
    console.log(`🔧 风格分析工作流ID: ${API_CONFIG.FASTGPT_STYLE.workflowId}`);
    console.log(`🔧 内容生成工作流ID: ${API_CONFIG.FASTGPT_CONTENT.workflowId}`);
    console.log('');
    console.log('📝 可通过localStorage保存的配置：');
    console.log('- API密钥（需要您自己配置）');
    console.log('- OSS配置（需要您自己配置）');
    console.log('');
    console.log('💡 优势：');
    console.log('✅ 重启项目后无需重新配置');
    console.log('✅ 换浏览器后无需重新配置');
    console.log('✅ 团队使用统一配置');
    console.log('==========================');
};

// 新增：显示模式对比帮助
window.showModes = function() {
    console.log('🔧 ======== 接口模式说明 ========');
    console.log('');
    console.log('💬 对话模式 (chat) - 推荐');
    console.log('  ✅ 优势：配置简单，只需API密钥');
    console.log('  ✅ 适用：内容生成、对话互动');
    console.log('  ❌ 限制：无法直接分析文件内容');
    console.log('  🔧 配置：setMode("chat") + setApiKey("你的密钥")');
    console.log('');
    console.log('⚙️  工作流模式 (workflow)');
    console.log('  ✅ 优势：可处理复杂任务，分析文件内容');
    console.log('  ✅ 适用：文档分析、复杂处理流程');
    console.log('  ❌ 限制：需要配置工作流ID，设置复杂');
    console.log('  🔧 配置：setMode("workflow") + 工作流ID');
    console.log('');
    console.log('💡 当前模式：' + (API_CONFIG.MODE === 'chat' ? '对话模式' : '工作流模式'));
    console.log('');
    console.log('🎯 快速切换：');
    console.log('  setMode("chat")     // 切换到对话模式');
    console.log('  setMode("workflow") // 切换到工作流模式');
    console.log('==========================');
};

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
        
        const response = await fetch(`/api/fastgpt/v1/chat/completions`, {
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

// 新增：清除所有配置
window.clearConfig = function() {
    if (confirm('确定要清除所有API配置吗？此操作将清除所有密钥和配置信息。')) {
        // 清除localStorage中的配置
        localStorage.removeItem('boss_kb_config');
        
        // 重置API_CONFIG为默认值
        API_CONFIG.FASTGPT_STYLE.apiKey = '';
        API_CONFIG.FASTGPT_CONTENT.apiKey = '';
        API_CONFIG.FASTGPT_STYLE.workflowId = '';
        API_CONFIG.FASTGPT_CONTENT.workflowId = '';
        API_CONFIG.OSS.accessKeyId = '';
        API_CONFIG.OSS.accessKeySecret = '';
        
        console.log('✅ 所有API配置已清除');
        showToast('API配置已清除，请重新配置', 'info');
        
        // 显示配置指南
        setTimeout(() => {
            console.log('💡 重新配置提示:');
            console.log('  设置API密钥: setApiKey("fastgpt-你的新密钥")');
            console.log('  查看配置指南: quickSetup()');
        }, 1000);
    }
};

// 新增：清除指定密钥
window.clearApiKey = function() {
    API_CONFIG.FASTGPT_STYLE.apiKey = '';
    API_CONFIG.FASTGPT_CONTENT.apiKey = '';
    localStorage.setItem('boss_kb_config', JSON.stringify(API_CONFIG));
    
    console.log('✅ API密钥已清除');
    showToast('API密钥已清除', 'info');
    
    console.log('💡 重新设置密钥: setApiKey("fastgpt-你的新密钥")');
};



// 新增：配置OSS
window.setOSSConfig = function(accessKeyId, accessKeySecret) {
    if (!accessKeyId || !accessKeySecret) {
        console.error('❌ 请提供完整的OSS配置信息');
        console.log('💡 使用方法: setOSSConfig("您的AccessKeyId", "您的AccessKeySecret")');
        return;
    }
    
    API_CONFIG.OSS.accessKeyId = accessKeyId;
    API_CONFIG.OSS.accessKeySecret = accessKeySecret;
    localStorage.setItem('boss_kb_config', JSON.stringify(API_CONFIG));
    
    console.log('✅ OSS配置已更新');
    console.log('AccessKey ID:', accessKeyId.substring(0, 10) + '...');
    showToast('OSS配置成功', 'success');
    
    // 立即初始化OSS
    initializeOSS().then(() => {
        console.log('✅ OSS已初始化，可以上传文件了');
    }).catch(error => {
        console.error('❌ OSS初始化失败:', error);
    });
};

// 新增：显示配置窗口
window.showConfig = function() {
    console.log('=== 当前配置状态 ===');
    console.log('🔧 接口模式:', API_CONFIG.MODE === 'chat' ? '对话接口模式' : '工作流接口模式');
    
    console.log('📁 OSS配置:');
    console.log('  AccessKey ID:', API_CONFIG.OSS.accessKeyId ? API_CONFIG.OSS.accessKeyId.substring(0, 10) + '...' : '❌ 未配置');
    console.log('  AccessKey Secret:', API_CONFIG.OSS.accessKeySecret ? '已配置' : '❌ 未配置');
    console.log('  Bucket:', API_CONFIG.OSS.bucket);
    
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
    console.log('  配置OSS: setOSSConfig("AccessKeyId", "AccessKeySecret")');
    console.log('  配置API密钥: setApiKey("fastgpt-你的密钥")');
    console.log('  显示配置窗口: showConfigModal()');
    console.log('  切换模式: setMode("chat") 或 setMode("workflow")');
    console.log('  测试API: testApi()');
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
    console.log('- showModes() // 查看模式说明');
    console.log('- showLocks() // 查看配置锁定说明');
    console.log('- clearConfig() // 清除所有配置');
    console.log('- clearApiKey() // 仅清除API密钥');
    console.log('- testApi() // 测试API连接');
    console.log('');
    console.log('📋 API密钥获取位置:');
    console.log('👉 登录FastGPT → 我的应用 → 选择应用 → API密钥');
    console.log('⚠️ 注意：使用应用专用密钥，不是账户密钥');
    console.log('===========================');
};

// 配置模态框相关函数
function showConfigModal() {
    console.log('📋 显示配置界面');
    
    // 加载当前配置到表单
    loadConfigToForm();
    
    // 显示模态框
    const modal = document.getElementById('config-modal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden'; // 防止背景滚动
    }
}

function closeConfigModal() {
    console.log('📋 关闭配置界面');
    
    const modal = document.getElementById('config-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto'; // 恢复背景滚动
    }
}

function loadConfigToForm() {
    // FastGPT配置
    const apikeyInput = document.getElementById('fastgpt-apikey');
    const styleWorkflowInput = document.getElementById('style-workflow-id');
    const contentWorkflowInput = document.getElementById('content-workflow-id');
    const apiModeSelect = document.getElementById('api-mode');
    
    // OSS配置
    const ossAccessKeyIdInput = document.getElementById('oss-access-key-id');
    const ossAccessKeySecretInput = document.getElementById('oss-access-key-secret');
    const ossBucketInput = document.getElementById('oss-bucket');
    const ossRegionInput = document.getElementById('oss-region');
    
    if (apikeyInput) apikeyInput.value = API_CONFIG.FASTGPT_CONTENT.apiKey || '';
    if (styleWorkflowInput) styleWorkflowInput.value = API_CONFIG.FASTGPT_STYLE.workflowId || '';
    if (contentWorkflowInput) contentWorkflowInput.value = API_CONFIG.FASTGPT_CONTENT.workflowId || '';
    if (apiModeSelect) apiModeSelect.value = API_CONFIG.MODE || 'chat';
    
    if (ossAccessKeyIdInput) ossAccessKeyIdInput.value = API_CONFIG.OSS.accessKeyId || '';
    if (ossAccessKeySecretInput) ossAccessKeySecretInput.value = API_CONFIG.OSS.accessKeySecret || '';
    if (ossBucketInput) ossBucketInput.value = API_CONFIG.OSS.bucket || '';
    if (ossRegionInput) ossRegionInput.value = API_CONFIG.OSS.region || '';
}

function saveConfig() {
    console.log('💾 保存配置');
    
    try {
        // 获取表单值
        const apikey = document.getElementById('fastgpt-apikey')?.value || '';
        const styleWorkflowId = document.getElementById('style-workflow-id')?.value || '';
        const contentWorkflowId = document.getElementById('content-workflow-id')?.value || '';
        const apiMode = document.getElementById('api-mode')?.value || 'chat';
        
        const ossAccessKeyId = document.getElementById('oss-access-key-id')?.value || '';
        const ossAccessKeySecret = document.getElementById('oss-access-key-secret')?.value || '';
        const ossBucket = document.getElementById('oss-bucket')?.value || '';
        const ossRegion = document.getElementById('oss-region')?.value || '';
        
        // 更新配置
        if (apikey) {
            API_CONFIG.FASTGPT_STYLE.apiKey = apikey;
            API_CONFIG.FASTGPT_CONTENT.apiKey = apikey;
        }
        
        if (styleWorkflowId) {
            API_CONFIG.FASTGPT_STYLE.workflowId = styleWorkflowId;
        }
        
        if (contentWorkflowId) {
            API_CONFIG.FASTGPT_CONTENT.workflowId = contentWorkflowId;
        }
        
        API_CONFIG.MODE = apiMode;
        
        if (ossAccessKeyId) {
            API_CONFIG.OSS.accessKeyId = ossAccessKeyId;
        }
        
        if (ossAccessKeySecret) {
            API_CONFIG.OSS.accessKeySecret = ossAccessKeySecret;
        }
        
        if (ossBucket) {
            API_CONFIG.OSS.bucket = ossBucket;
        }
        
        if (ossRegion) {
            API_CONFIG.OSS.region = ossRegion;
        }
        
        // 保存到localStorage
        localStorage.setItem('boss_kb_config', JSON.stringify(API_CONFIG));
        
        console.log('✅ 配置保存成功');
        showToast('配置保存成功', 'success');
        
        // 如果配置了OSS，重新初始化
        if (API_CONFIG.OSS.accessKeyId && API_CONFIG.OSS.accessKeySecret) {
            initializeOSS().then(() => {
                console.log('✅ OSS重新初始化成功');
            }).catch(error => {
                console.error('❌ OSS重新初始化失败:', error);
            });
        }
        
        // 关闭模态框
        closeConfigModal();
        
    } catch (error) {
        console.error('❌ 配置保存失败:', error);
        showToast('配置保存失败: ' + error.message, 'error');
    }
}

function clearAllConfig() {
    if (confirm('确定要清除所有配置吗？此操作将清除所有API密钥和配置信息。')) {
        // 清除localStorage
        localStorage.removeItem('boss_kb_config');
        
        // 重置配置
        API_CONFIG.FASTGPT_STYLE.apiKey = '';
        API_CONFIG.FASTGPT_CONTENT.apiKey = '';
        API_CONFIG.FASTGPT_STYLE.workflowId = '';
        API_CONFIG.FASTGPT_CONTENT.workflowId = '';
        API_CONFIG.OSS.accessKeyId = '';
        API_CONFIG.OSS.accessKeySecret = '';
        API_CONFIG.MODE = 'chat';
        
        // 清空表单
        loadConfigToForm();
        
        console.log('✅ 所有配置已清除');
        showToast('所有配置已清除', 'info');
    }
}

function testApiConnection() {
    console.log('🔄 测试API连接');
    
    // 先保存当前配置
    saveConfig();
    
    // 延迟一下再测试，确保配置已保存
    setTimeout(() => {
        if (window.testApi) {
            window.testApi();
        } else {
            console.error('❌ testApi函数不存在');
            showToast('测试函数不存在', 'error');
        }
    }, 500);
}

// 点击模态框背景关闭
document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('config-modal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeConfigModal();
            }
        });
    }
    
    // ESC键关闭模态框
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeConfigModal();
        }
    });
});

 