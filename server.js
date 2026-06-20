const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// 数据目录
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 中间件
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ========== 用户系统相关函数 ==========

// 确保用户文件存在
function ensureUsersFile() {
    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
    }
}

// 读取用户数据
function readUsers() {
    ensureUsersFile();
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error('读取用户数据失败:', e);
        return [];
    }
}

// 保存用户数据
function saveUsers(users) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
        return true;
    } catch (e) {
        console.error('保存用户数据失败:', e);
        return false;
    }
}

// 密码加密（简单的md5，演示用）
function hashPassword(password) {
    return crypto.createHash('md5').update(password).digest('hex');
}

// 生成token
function generateToken(username) {
    return crypto.createHash('md5').update(username + Date.now() + Math.random()).digest('hex');
}

// 根据token获取用户
function getUserByToken(token) {
    if (!token) return null;
    const users = readUsers();
    return users.find(u => u.token === token) || null;
}

// ========== 题库数据相关函数（按用户隔离） ==========

// 获取用户的题库数据文件路径
function getUserBanksFile(username) {
    const userDir = path.join(DATA_DIR, 'users', username);
    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
    }
    return path.join(userDir, 'banks.json');
}

// 读取用户的题库数据
function readUserBanks(username) {
    const file = getUserBanksFile(username);
    try {
        if (!fs.existsSync(file)) {
            return [];
        }
        const data = fs.readFileSync(file, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        console.error('读取用户题库失败:', e);
        return [];
    }
}

// 保存用户的题库数据
function saveUserBanks(username, banks) {
    try {
        const file = getUserBanksFile(username);
        fs.writeFileSync(file, JSON.stringify(banks, null, 2));
        return true;
    } catch (e) {
        console.error('保存用户题库失败:', e);
        return false;
    }
}

// ========== 认证中间件 ==========
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const user = getUserByToken(token);
    
    if (!user) {
        return res.status(401).json({
            success: false,
            message: '未登录或登录已过期'
        });
    }
    
    req.user = user;
    next();
}

// ========== API 接口 ==========

// ========== 用户认证接口 ==========

// 用户注册
app.post('/api/auth/register', (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: '用户名和密码不能为空'
            });
        }
        
        if (username.length < 3) {
            return res.status(400).json({
                success: false,
                message: '用户名至少3个字符'
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: '密码至少6个字符'
            });
        }
        
        const users = readUsers();
        
        // 检查用户名是否已存在
        if (users.find(u => u.username === username)) {
            return res.status(400).json({
                success: false,
                message: '用户名已存在'
            });
        }
        
        // 创建新用户
        const token = generateToken(username);
        const newUser = {
            username: username,
            password: hashPassword(password),
            token: token,
            createdAt: new Date().toISOString()
        };
        
        users.push(newUser);
        saveUsers(users);
        
        res.json({
            success: true,
            message: '注册成功',
            data: {
                username: username,
                token: token
            }
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            message: '注册失败: ' + e.message
        });
    }
});

// 用户登录
app.post('/api/auth/login', (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: '用户名和密码不能为空'
            });
        }
        
        const users = readUsers();
        const user = users.find(u => u.username === username);
        
        if (!user) {
            return res.status(400).json({
                success: false,
                message: '用户名或密码错误'
            });
        }
        
        if (user.password !== hashPassword(password)) {
            return res.status(400).json({
                success: false,
                message: '用户名或密码错误'
            });
        }
        
        // 生成新token
        const token = generateToken(username);
        user.token = token;
        saveUsers(users);
        
        res.json({
            success: true,
            message: '登录成功',
            data: {
                username: username,
                token: token
            }
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            message: '登录失败: ' + e.message
        });
    }
});

// 获取当前用户信息
app.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: {
            username: req.user.username,
            createdAt: req.user.createdAt
        }
    });
});

// ========== 题库接口（需要认证） ==========

// 获取所有题库
app.get('/api/banks', authMiddleware, (req, res) => {
    try {
        const banks = readUserBanks(req.user.username);
        res.json({
            success: true,
            data: banks,
            count: banks.length
        });
    } catch (e) {
        res.status(500).json({
            success: false,
            message: '获取题库失败: ' + e.message
        });
    }
});

// 添加/更新题库
app.post('/api/banks', authMiddleware, (req, res) => {
    try {
        const bank = req.body;
        const username = req.user.username;
        
        // 验证数据格式
        if (!bank.subject || !bank.papers || !Array.isArray(bank.papers)) {
            return res.status(400).json({
                success: false,
                message: '题库数据格式不正确，需要包含subject和papers字段'
            });
        }
        
        const banks = readUserBanks(username);
        
        // 检查是否已存在
        const index = banks.findIndex(b => b.subject === bank.subject);
        let message;
        if (index !== -1) {
            // 已存在，更新
            banks[index] = bank;
            message = '题库更新成功';
        } else {
            // 不存在，添加
            banks.push(bank);
            message = '题库添加成功';
        }
        
        // 保存
        if (saveUserBanks(username, banks)) {
            res.json({
                success: true,
                message: message,
                data: bank
            });
        } else {
            res.status(500).json({
                success: false,
                message: '保存题库失败'
            });
        }
    } catch (e) {
        res.status(500).json({
            success: false,
            message: '操作失败: ' + e.message
        });
    }
});

// 更新指定题库
app.put('/api/banks/:subject', authMiddleware, (req, res) => {
    try {
        const subject = req.params.subject;
        const bank = req.body;
        const username = req.user.username;
        
        // 验证数据格式
        if (!bank.subject || !bank.papers || !Array.isArray(bank.papers)) {
            return res.status(400).json({
                success: false,
                message: '题库数据格式不正确'
            });
        }
        
        const banks = readUserBanks(username);
        const index = banks.findIndex(b => b.subject === subject);
        
        if (index === -1) {
            return res.status(404).json({
                success: false,
                message: '未找到指定题库'
            });
        }
        
        banks[index] = bank;
        
        if (saveUserBanks(username, banks)) {
            res.json({
                success: true,
                message: '题库更新成功',
                data: bank
            });
        } else {
            res.status(500).json({
                success: false,
                message: '保存题库失败'
            });
        }
    } catch (e) {
        res.status(500).json({
            success: false,
            message: '更新失败: ' + e.message
        });
    }
});

// 删除题库
app.delete('/api/banks/:subject', authMiddleware, (req, res) => {
    try {
        const subject = req.params.subject;
        const username = req.user.username;
        const banks = readUserBanks(username);
        const index = banks.findIndex(b => b.subject === subject);
        
        if (index === -1) {
            return res.status(404).json({
                success: false,
                message: '未找到指定题库'
            });
        }
        
        const deleted = banks.splice(index, 1)[0];
        
        if (saveUserBanks(username, banks)) {
            res.json({
                success: true,
                message: '题库删除成功',
                data: deleted
            });
        } else {
            res.status(500).json({
                success: false,
                message: '保存数据失败'
            });
        }
    } catch (e) {
        res.status(500).json({
            success: false,
            message: '删除失败: ' + e.message
        });
    }
});

// 批量导入题库
app.post('/api/banks/batch', authMiddleware, (req, res) => {
    try {
        const banks = req.body;
        const username = req.user.username;
        
        if (!Array.isArray(banks)) {
            return res.status(400).json({
                success: false,
                message: '数据格式不正确，应为题库数组'
            });
        }
        
        const existingBanks = readUserBanks(username);
        let addedCount = 0;
        let updatedCount = 0;
        
        banks.forEach(bank => {
            if (!bank.subject || !bank.papers || !Array.isArray(bank.papers)) {
                return; // 跳过格式不正确的
            }
            
            const index = existingBanks.findIndex(b => b.subject === bank.subject);
            if (index !== -1) {
                existingBanks[index] = bank;
                updatedCount++;
            } else {
                existingBanks.push(bank);
                addedCount++;
            }
        });
        
        if (saveUserBanks(username, existingBanks)) {
            res.json({
                success: true,
                message: `批量导入成功，新增 ${addedCount} 个，更新 ${updatedCount} 个`,
                added: addedCount,
                updated: updatedCount
            });
        } else {
            res.status(500).json({
                success: false,
                message: '保存数据失败'
            });
        }
    } catch (e) {
        res.status(500).json({
            success: false,
            message: '批量导入失败: ' + e.message
        });
    }
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: '服务运行正常',
        timestamp: new Date().toISOString()
    });
});

// 首页路由
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'exam_system.html'));
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`
========================================
  通用在线考试系统 - 后端服务已启动
========================================
  访问地址: http://localhost:${PORT}
  API地址:  http://localhost:${PORT}/api
  数据目录: ${DATA_DIR}
  用户系统: 已启用（多用户数据隔离）
========================================
  按 Ctrl+C 停止服务
========================================
    `);
});
