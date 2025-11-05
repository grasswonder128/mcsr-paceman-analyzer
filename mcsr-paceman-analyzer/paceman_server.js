// paceman_proxy_server.js
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const dns = require("dns");

const app = express();
app.use(cors());
dns.setDefaultResultOrder("ipv4first");

const PORT = 3001;

// 缓存设置 
const cache = {};
const CACHE_EXPIRATION_TIME = 10 * 60 * 1000; // 10分钟

// 检查更新缓存
function getCachedResponse(key, fetchFunction) {
  const now = Date.now();

  // 检查缓存
  if (cache[key] && now - cache[key].timestamp < CACHE_EXPIRATION_TIME) {
    console.log(`使用缓存数据: ${key}`);
    return Promise.resolve(cache[key].data);
  }

  // 获取新数据
  return fetchFunction().then((data) => {
    cache[key] = { data, timestamp: now };
    console.log(`获取新数据并缓存: ${key}`);
    return data;
  });
}

// 30天数据端点配置
const days = 30;
const limit_player_num = 100;
const type = "count";

const leaderboardCategories = [
  "nether", "bastion", "fortress", "first_structure", 
  "second_structure", "first_portal", "stronghold", "end", "finish"
];

// 排行榜API端点
leaderboardCategories.forEach((category) => {
  app.get(`/get${category}Leaderboard`, async (req, res) => {
    const cacheKey = `leaderboard_${category}_${days}days`;

    try {
      const data = await getCachedResponse(cacheKey, async () => {
        const response = await axios.get(
          `https://paceman.gg/stats/api/getLeaderboard/`,
          {
            params: {
              category,
              type,
              days: days,
              limit: limit_player_num
            }
          }
        );
        console.log(`获取 ${category} 排行榜 (${days} 天):`, response.data.length);
        return response.data;
      });

      res.json({
        success: true,
        category,
        period: `${days}days`,
        data: data
      });
    } catch (error) {
      console.error(`获取 ${category} 排行榜错误:`, error.message);
      res.status(500).json({ 
        success: false, 
        message: "获取数据失败", 
        error: error.message 
      });
    }
  });
});

// get玩家30天统计数据
app.get("/getStats", async (req, res) => {
  const { name } = req.query;
  const cacheKey = `stats_${name}_${days}days`;

  if (!name) {
    return res.status(400).json({ 
      success: false, 
      message: "玩家名称参数必填" 
    });
  }

  try {
    const data = await getCachedResponse(cacheKey, async () => {
      const response = await axios.get(
        `https://paceman.gg/stats/api/getSessionStats/`,
        {
          params: {
            name: name,
            hours: days * 24,
            hoursBetween: days * 24
          }
        }
      );
      return response.data;
    });

    res.json({
      success: true,
      player: name,
      period: `${days}days`,
      stats: data
    });
  } catch (error) {
    console.error(`获取玩家 ${name} 统计数据错误:`, error.message);
    res.status(500).json({ 
      success: false, 
      message: "获取数据失败", 
      error: error.message 
    });
  }
});

// get玩家30天运行记录（只包含有End数据）
app.get("/getRecentRuns", async (req, res) => {
  const { name, limit = 100 } = req.query;
  const cacheKey = `recent_runs_${name}_${limit}_${days}days`;

  if (!name) {
    return res.status(400).json({ 
      success: false, 
      message: "玩家名称参数必填" 
    });
  }

  try {
    const data = await getCachedResponse(cacheKey, async () => {
      const response = await axios.get(
        `https://paceman.gg/stats/api/getRecentRuns/`,
        {
          params: {
            name: name,
            hours: days * 24,
            limit: limit,
            hoursBetween: days * 24
          }
        }
      );
      return response.data;
    });

    // 过滤只保留有End数据的运行记录
    const runsWithEnd = data.filter(run => run.end !== null && run.end !== undefined);

    res.json({
      success: true,
      player: name,
      period: `${days}days`,
      totalRuns: data.length,
      runsWithEnd: runsWithEnd.length,
      completionRate: data.length > 0 ? ((runsWithEnd.length / data.length) * 100).toFixed(1) + '%' : '0%',
      runs: runsWithEnd
    });
  } catch (error) {
    console.error(`获取玩家 ${name} 运行记录错误:`, error.message);
    res.status(500).json({ 
      success: false, 
      message: "获取数据失败", 
      error: error.message 
    });
  }
});

// get世界详细数据
app.get("/getWorld", async (req, res) => {
  const { worldId } = req.query;
  const cacheKey = `world_${worldId}`;

  if (!worldId) {
    return res.status(400).json({ 
      success: false, 
      message: "世界ID参数必填" 
    });
  }

  try {
    const data = await getCachedResponse(cacheKey, async () => {
      const response = await axios.get(
        `https://paceman.gg/stats/api/getWorld/`,
        {
          params: { worldId }
        }
      );
      return response.data;
    });

    res.json({
      success: true,
      worldId: worldId,
      data: data
    });
  } catch (error) {
    console.error(`获取世界 ${worldId} 数据错误:`, error.message);
    res.status(500).json({ 
      success: false, 
      message: "获取数据失败", 
      error: error.message 
    });
  }
});

// 批量获取玩家数据
app.get("/getBatchData", async (req, res) => {
  const { players } = req.query;
  
  if (!players) {
    return res.status(400).json({ 
      success: false, 
      message: "玩家列表参数必填（逗号分隔）" 
    });
  }

  const playerList = players.split(',');
  const results = [];

  for (const player of playerList.slice(0, 5)) { // 限制一次处理5个玩家
    try {
      // get统计数据
      const statsResponse = await axios.get(
        `https://paceman.gg/stats/api/getSessionStats/`,
        {
          params: {
            name: player.trim(),
            hours: days * 24,
            hoursBetween: days * 24
          }
        }
      );

      // get运行记录
      const runsResponse = await axios.get(
        `https://paceman.gg/stats/api/getRecentRuns/`,
        {
          params: {
            name: player.trim(),
            hours: days * 24,
            limit: 50,
            hoursBetween: days * 24
          }
        }
      );

      // 过滤有End数据的运行记录
      const runsWithEnd = runsResponse.data.filter(run => run.end !== null && run.end !== undefined);

      results.push({
        player: player.trim(),
        success: true,
        stats: statsResponse.data,
        totalRuns: runsResponse.data.length,
        runsWithEnd: runsWithEnd.length,
        completionRate: runsResponse.data.length > 0 ? ((runsWithEnd.length / runsResponse.data.length) * 100).toFixed(1) + '%' : '0%',
        runs: runsWithEnd.slice(0, 10) // 只返回前10条记录
      });

      // 延迟避免请求过快
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      results.push({
        player: player.trim(),
        success: false,
        error: error.response?.status === 404 ? "玩家不存在" : error.message
      });
      
      // 错误时也延迟
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  res.json({
    success: true,
    period: `${days}days`,
    playersProcessed: results.length,
    results: results
  });
});

// get热门玩家列表
app.get("/getTopPlayers", async (req, res) => {
  const { limit = 50 } = req.query;
  const cacheKey = `top_players_${limit}`;

  try {
    const data = await getCachedResponse(cacheKey, async () => {
      const response = await axios.get(
        `https://paceman.gg/stats/api/getLeaderboard/`,
        {
          params: {
            category: "end",
            type: "count",
            days: 30,
            limit
          }
        }
      );
      return response.data;
    });

    const topPlayers = data.map(player => ({
      name: player.name,
      uuid: player.uuid,
      runCount: player.value || player.qty,
      averageTime: player.avg
    }));

    res.json({
      success: true,
      period: `${days}days`,
      players: topPlayers
    });
  } catch (error) {
    console.error("获取热门玩家列表错误:", error.message);
    res.status(500).json({ 
      success: false, 
      message: "获取数据失败", 
      error: error.message 
    });
  }
});

// 健康检查端点
app.get("/health", (req, res) => {
  res.json({ 
    status: "运行正常", 
    timestamp: new Date().toISOString(),
    cacheSize: Object.keys(cache).length,
    period: `${days}天数据`
  });
});

// 缓存状态端点
app.get("/cache-status", (req, res) => {
  const cacheInfo = Object.keys(cache).map(key => ({
    key,
    age: Math.round((Date.now() - cache[key].timestamp) / 1000) + '秒前',
    dataLength: Array.isArray(cache[key].data) ? cache[key].data.length : 'object'
  }));
  
  res.json({
    totalCachedItems: cacheInfo.length,
    period: `${days}天数据`,
    items: cacheInfo
  });
});

// 清空缓存端点
app.delete("/cache", (req, res) => {
  const keys = Object.keys(cache);
  const count = keys.length;
  Object.keys(cache).forEach(key => delete cache[key]);
  res.json({
    success: true,
    message: `清空了 ${count} 个缓存项`
  });
});

// 首页
app.get("/", (req, res) => {
  res.json({
    message: "Minecraft速通数据代理服务器",
    version: "1.0.0",
    period: `${days}天数据`,
    endpoints: {
      "排行榜": "/get{Category}Leaderboard",
      "玩家统计": "/getStats?name=玩家名",
      "运行记录": "/getRecentRuns?name=玩家名",
      "批量数据": "/getBatchData?players=玩家1,玩家2",
      "热门玩家": "/getTopPlayers",
      "健康检查": "/health",
      "缓存状态": "/cache-status"
    }
  });
});

app.listen(PORT, () => {
  console.log("================================================");
  console.log("Minecraft速通数据代理服务器启动成功!");
  console.log(`服务器地址: http://localhost:${PORT}`);
  console.log(`数据周期: ${days}天`);
  console.log("================================================");
  console.log("可用端点:");
  console.log("  GET  /                            - 首页");
  console.log("  GET  /get{Category}Leaderboard    - 获取排行榜");
  console.log("  GET  /getStats?name=玩家名        - 获取玩家统计");
  console.log("  GET  /getRecentRuns?name=玩家名   - 获取运行记录");
  console.log("  GET  /getBatchData?players=玩家列表 - 批量获取数据");
  console.log("  GET  /getTopPlayers               - 获取热门玩家");
  console.log("  GET  /health                      - 健康检查");
  console.log("  GET  /cache-status                - 缓存状态");
  console.log("  DELETE /cache                     - 清空缓存");
  console.log("================================================");
});