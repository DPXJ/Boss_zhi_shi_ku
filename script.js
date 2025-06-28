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
    // FastGPT工作流配置
    FASTGPT: {
        baseUrl: 'https://api.fastgpt.in/api',
        apiKey: '',
        workflows: {
            styleAnalysis: '685c9d7e6adb97a0858caaa6',
            contentGeneration: '685f87df49b71f158b57ae61'
        }
    }
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
    isGenerating: false
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

// 调用FastGPT工作流A（风格分析）
async function callStyleAnalysisWorkflow(articleUrls) {
    const response = await fetch(`${API_CONFIG.FASTGPT.baseUrl}/api/workflow/run`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_CONFIG.FASTGPT.apiKey}`
        },
        body: JSON.stringify({
            workflowId: API_CONFIG.FASTGPT.workflows.styleAnalysis,
            variables: {
                article_input: articleUrls
            }
        })
    });
    
    if (!response.ok) {
        throw new Error(`风格分析API调用失败: ${response.status}`);
    }
    
    const result = await response.json();
    return result.data.style_output;
}

// 调用FastGPT工作流B（内容生成）
async function callContentGenerationWorkflow(styleOutput, contentLength, topic, styleType, remark) {
    const response = await fetch(`${API_CONFIG.FASTGPT.baseUrl}/api/workflow/run`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_CONFIG.FASTGPT.apiKey}`
        },
        body: JSON.stringify({
            workflowId: API_CONFIG.FASTGPT.workflows.contentGeneration,
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
        throw new Error(`内容生成API调用失败: ${response.status}`);
    }
    
    const result = await response.json();
    return result.data.AIcontent_output;
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
        
        // 调用风格分析工作流
        const styleOutput = await callStyleAnalysisWorkflow(allUrls);
        
        appState.styleOutput = styleOutput;
        updateAnalysisStatus(`风格分析完成：${styleOutput}`);
        showToast('风格分析完成', 'success');
        
    } catch (error) {
        console.error('风格分析失败:', error);
        appState.styleOutput = '默认正式严谨风格'; // 设置默认风格
        updateAnalysisStatus(`使用默认风格：${appState.styleOutput}`);
        showToast('风格分析异常，使用默认风格', 'info');
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
        // 尝试调用内容生成工作流
        const generatedContent = await callContentGenerationWorkflow(
            appState.styleOutput,
            contentLength,
            topic,
            contentType,
            notes
        );
        
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
    Object.assign(API_CONFIG.FASTGPT, config.FASTGPT || {});
    
    // 重新初始化OSS客户端
    if (config.OSS) {
        initializeOSS();
    }
    
    console.log('API配置已更新');
}

// 检查配置并显示配置界面
function checkAPIConfig() {
    const needsConfig = !API_CONFIG.OSS.accessKeyId || !API_CONFIG.OSS.accessKeySecret || !API_CONFIG.FASTGPT.apiKey;
    
    if (needsConfig) {
        showConfigModal();
        return false;
    }
    return true;
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
                <input type="password" id="fastgpt-key" placeholder="FastGPT API Key" value="${API_CONFIG.FASTGPT.apiKey}">
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
    const fastgptKey = document.getElementById('fastgpt-key').value.trim();
    
    if (ossKeyId && ossKeySecret && fastgptKey) {
        API_CONFIG.OSS.accessKeyId = ossKeyId;
        API_CONFIG.OSS.accessKeySecret = ossKeySecret;
        API_CONFIG.FASTGPT.apiKey = fastgptKey;
        
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

// 页面加载完成后的初始化
document.addEventListener('DOMContentLoaded', async function() {
    // 从本地存储加载配置
    loadConfigFromStorage();
    
    // 检查配置并初始化
    if (checkAPIConfig()) {
        // 配置完整，初始化OSS客户端
        try {
            await initializeOSS();
        } catch (error) {
            console.error('OSS初始化失败:', error);
        }
    }
    
    // 设置拖拽上传
    setupDragDrop();
    
    // 初始化分析状态
    updateAnalysisStatus();
    
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
    
    // 显示欢迎信息
    setTimeout(() => {
        showToast('老板专属知识库已就绪，请上传参考文件开始使用！', 'info');
    }, 2000);
});

// 导出配置函数供外部调用
window.setAPIConfig = setAPIConfig; 