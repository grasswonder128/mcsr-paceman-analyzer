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
const CACHE_EXPIRATION_TIME = 10 * 60 * 1000; 

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


// 获取玩家全历史统计数据
app.get("/getLifetimeStats", async (req, res) => {
  const { name } = req.query;
  const cacheKey = `lifetime_stats_${name}`;

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
            hours: 999999,  // 最大时间范围
            hoursBetween: 999999
          }
        }
      );
      console.log(`获取玩家 ${name} 全历史统计数据:`, Object.keys(response.data));
      return response.data;
    });

    res.json({
      success: true,
      player: name,
      period: "lifetime",
      stats: data
    });
  } catch (error) {
    console.error(`获取玩家 ${name} 全历史统计数据错误:`, error.message);
    res.status(500).json({ 
      success: false, 
      message: "获取全历史数据失败", 
      error: error.message 
    });
  }
});

// 获取玩家全历史运行记录
app.get("/getLifetimeRuns", async (req, res) => {
  const { name, limit = 1000 } = req.query;
  const cacheKey = `lifetime_runs_${name}_${limit}`;

  if (!name) {
    return res.status(400).json({ 
      success: false, 
      message: "玩家名称参数必填" 
    });
  }

  try {
    const data = await getCachedResponse(cacheKey, async () => {
      // 使用最大时间范围获取所有记录
      const response = await axios.get(
        `https://paceman.gg/stats/api/getRecentRuns/`,
        {
          params: {
            name: name,
            hours: 999999,  // 最大时间范围
            limit: limit,
            hoursBetween: 999999
          }
        }
      );
      console.log(`获取玩家 ${name} 全历史运行记录: ${response.data.length} 条`);
      return response.data;
    });

    // 不进行过滤，返回所有记录
    const allRuns = data;

    res.json({
      success: true,
      player: name,
      period: "lifetime",
      totalRuns: allRuns.length,
      completedRuns: allRuns.filter(run => run.finish !== null && run.finish !== undefined).length,
      endRuns: allRuns.filter(run => run.end !== null && run.end !== undefined).length,
      completionRate: allRuns.length > 0 ? 
        ((allRuns.filter(run => run.finish !== null).length / allRuns.length) * 100).toFixed(1) + '%' : '0%',
      runs: allRuns
    });
  } catch (error) {
    console.error(`获取玩家 ${name} 全历史运行记录错误:`, error.message);
    res.status(500).json({ 
      success: false, 
      message: "获取全历史运行记录失败", 
      error: error.message 
    });
  }
});


// 获取玩家行为分析报告
app.get("/getBehaviorAnalysis", async (req, res) => {
  const { name } = req.query;
  const cacheKey = `behavior_analysis_${name}`;

  if (!name) {
    return res.status(400).json({ 
      success: false, 
      message: "玩家名称参数必填" 
    });
  }

  try {
    const analysisData = await getCachedResponse(cacheKey, async () => {
      console.log(`=== 开始获取玩家 ${name} 的行为分析数据 ===`);
      
      // 获取全历史统计数据
      const statsResponse = await axios.get(`https://paceman.gg/stats/api/getSessionStats/`, {
        params: { name, hours: 999999, hoursBetween: 999999 }
      });

      // 获取运行记录
      let limit = 1000000;
      const runsResponse = await axios.get(`https://paceman.gg/stats/api/getRecentRuns/`, {
        params: { name, hours: 999999, limit: limit, hoursBetween: 999999 }
      });

      const allRuns = runsResponse.data;
      
      console.log(`获取到的运行记录数量: ${allRuns.length}`);
      console.log(`请求的limit参数: ${limit}`);
      
      if (allRuns.length > 0) {
        console.log(`第一条记录时间: ${new Date(allRuns[0].time * 1000).toLocaleDateString()}`);
        console.log(`最后一条记录时间: ${new Date(allRuns[allRuns.length - 1].time * 1000).toLocaleDateString()}`);
      }
      
      // 检查完成记录数量
      const completedRuns = allRuns.filter(run => run.finish && run.finish > 0);
      console.log(`完成记录数量: ${completedRuns.length}`);
      
      // 计算行为分析指标
      const behaviorAnalysis = calculateBehaviorAnalysis(allRuns, statsResponse.data);
      
      console.log(`=== 玩家 ${name} 行为分析完成 ===`);
      
      return behaviorAnalysis;
    });

    res.json({
      success: true,
      player: name,
      period: "lifetime",
      analysis: analysisData
    });
  } catch (error) {
    console.error(`获取玩家 ${name} 行为分析错误:`, error.message);
    res.status(500).json({ 
      success: false, 
      message: "行为分析失败", 
      error: error.message 
    });
  }
});

// 测试端点
app.get("/getBehaviorAnalysisTest", async (req, res) => {
  const { name } = req.query;

  if (!name) {
    return res.status(400).json({ 
      success: false, 
      message: "玩家名称参数必填" 
    });
  }

  try {
    console.log(`=== 测试模式: 获取玩家 ${name} 的行为分析数据 ===`);
    
    const statsResponse = await axios.get(`https://paceman.gg/stats/api/getSessionStats/`, {
      params: { name, hours: 999999, hoursBetween: 999999 }
    });

    const limits = [100, 500, 1000, 2000];
    let allRuns = [];
    
    for (let limit of limits) {
      try {
        const runsResponse = await axios.get(`https://paceman.gg/stats/api/getRecentRuns/`, {
          params: { name, hours: 999999, limit: limit, hoursBetween: 999999 }
        });
        
        console.log(`limit=${limit} 时获取到 ${runsResponse.data.length} 条记录`);
        
        if (runsResponse.data.length > allRuns.length) {
          allRuns = runsResponse.data;
        }
        
        if (runsResponse.data.length < limit) {
          console.log(`数据已全部获取，实际记录数: ${runsResponse.data.length}`);
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.log(`limit=${limit} 时出错:`, error.message);
      }
    }
    
    console.log(`最终获取的运行记录数量: ${allRuns.length}`);
    
    // 计算行为分析指标
    const behaviorAnalysis = calculateBehaviorAnalysis(allRuns, statsResponse.data);
    
    res.json({
      success: true,
      player: name,
      period: "lifetime",
      actualRecords: allRuns.length,
      analysis: behaviorAnalysis
    });
  } catch (error) {
    console.error(`测试获取玩家 ${name} 行为分析错误:`, error.message);
    res.status(500).json({ 
      success: false, 
      message: "行为分析失败", 
      error: error.message 
    });
  }
});

// 计算分位数
function calculatePercentiles(times) {
  if (!times || times.length === 0) {
    return { p25: 0, p50: 0, p75: 0 };
  }
  
  const sortedTimes = [...times].sort((a, b) => a - b);
  const n = sortedTimes.length;
  
  const p25Index = Math.floor(n * 0.25);
  const p50Index = Math.floor(n * 0.50);
  const p75Index = Math.floor(n * 0.75);
  
  return {
    p25: sortedTimes[p25Index],
    p50: sortedTimes[p50Index],
    p75: sortedTimes[p75Index]
  };
}

// 格式化时间为分钟:秒
function formatTimeFromMs(ms) {
  if (!ms || ms === 0) return "N/A";
  
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// 主行为分析函数
function calculateBehaviorAnalysis(runs, stats) {
  console.log(`开始行为分析: 总运行记录 ${runs.length} 条`);

  // 过滤出完成记录
  const completedRuns = runs.filter(run => run.finish && run.finish > 0);
  const finishTimes = completedRuns.map(run => run.finish);

  console.log(`完成记录数量: ${completedRuns.length}`);
  
  // 计算个人基准线
  const percentiles = calculatePercentiles(finishTimes);
  const personalBaseline = {
    p50: formatTimeFromMs(percentiles.p50),
    p25: formatTimeFromMs(percentiles.p25),
    p75: formatTimeFromMs(percentiles.p75),
    basedOnRuns: completedRuns.length
  };
  console.log(`个人基准线基于 ${completedRuns.length} 次完成记录`);
  
  // 计算重置模式
  const resetPatterns = calculateResetPatterns(runs);
  
  // 计算进度稳定性
  const progressionStability = calculateProgressionStability(runs);
  
  // 计算学习进步指标
  const learningMetrics = calculateLearningMetrics(completedRuns);
  
  // 计算运气影响评估
  const luckAssessment = assessLuckImpact(runs, personalBaseline);
  
  // 玩家状态分类
  const playerState = classifyPlayerState({
    consistency: progressionStability.overallConsistency,
    learningRate: learningMetrics.learningRate,
    resetEfficiency: resetPatterns.resetEfficiency
  });
  
  return {
    personalBaseline,
    resetPatterns,
    progressionStability,
    learningMetrics,
    luckAssessment,
    playerState,
    summary: generateAnalysisSummary(playerState, personalBaseline, learningMetrics)
  };
}

// 计算重置模式
function calculateResetPatterns(runs) {
  // 使用所有可用数据，但最多分析最近200次运行
  const maxRunsToAnalyze = Math.min(runs.length, 20000);
  const recentRuns = runs.slice(0, maxRunsToAnalyze);
  
  console.log(`重置模式分析: 使用 ${recentRuns.length} 条运行记录`);
  
  // 早期重置（前3分钟内）
  const earlyResets = recentRuns.filter(run => 
    run.nether && run.nether < 180000 && !run.finish
  ).length;
  
  // 中期重置（3-10分钟）
  const midResets = recentRuns.filter(run => 
    run.nether && run.nether >= 180000 && run.nether < 600000 && !run.finish
  ).length;
  
  // 晚期重置（10分钟后）
  const lateResets = recentRuns.filter(run => 
    run.nether && run.nether >= 600000 && !run.finish
  ).length;
  
  const totalResets = earlyResets + midResets + lateResets;
  const resetEfficiency = totalResets > 0 ? 
    (midResets + lateResets) / totalResets : 1;

  // 根据重置效率判断策略类型
  let resetStrategy = '合理';
  if (resetEfficiency < 0.4) {
    resetStrategy = '激进';
  } else if (resetEfficiency > 0.7) {
    resetStrategy = '保守';
  }
  
  console.log(`重置模式统计: 早期${earlyResets}次, 中期${midResets}次, 晚期${lateResets}次, 策略:${resetStrategy}`);
  
  return {
    earlyResets,
    midResets, 
    lateResets,
    totalResets,
    resetEfficiency: Math.round(resetEfficiency * 100) / 100,
    resetRate: recentRuns.length > 0 ? (totalResets / recentRuns.length) : 0,
    resetStrategy
  };
}

// 计算进度稳定性
function calculateProgressionStability(runs) {
  const completedRuns = runs.filter(run => run.finish && run.finish > 0);
  
  if (completedRuns.length < 3) {
    return {
      overallConsistency: 0.5,
      segmentConsistency: {},
      streakInfo: { currentStreak: 0, bestStreak: 0 }
    };
  }
  
  // 计算各分段时间的稳定性
  const segments = ['nether', 'bastion', 'fortress', 'first_portal', 'stronghold', 'end'];
  const segmentConsistency = {};
  
  segments.forEach(segment => {
    const segmentTimes = completedRuns
      .filter(run => run[segment] && run[segment] > 0)
      .map(run => run[segment]);
    
    if (segmentTimes.length >= 3) {
      const mean = segmentTimes.reduce((a, b) => a + b) / segmentTimes.length;
      const variance = segmentTimes.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / segmentTimes.length;
      const cv = Math.sqrt(variance) / mean; // 变异系数
      
      segmentConsistency[segment] = Math.max(0, 1 - cv); // 变异系数越小，一致性越高
    }
  });
  
  // 计算整体一致性（各分段一致性的平均值）
  const consistencyValues = Object.values(segmentConsistency);
  const overallConsistency = consistencyValues.length > 0 ? 
    consistencyValues.reduce((a, b) => a + b) / consistencyValues.length : 0.5;
  
  // 计算连续完成记录
  let currentStreak = 0;
  let bestStreak = 0;
  let tempStreak = 0;
  
  // 按时间排序（从旧到新）
  const sortedRuns = [...runs].sort((a, b) => (a.time || 0) - (b.time || 0));
  
  sortedRuns.forEach(run => {
    if (run.finish && run.finish > 0) {
      tempStreak++;
      currentStreak = tempStreak;
      bestStreak = Math.max(bestStreak, tempStreak);
    } else {
      tempStreak = 0;
    }
  });
  
  return {
    overallConsistency: Math.round(overallConsistency * 100) / 100,
    segmentConsistency,
    streakInfo: {
      currentStreak,
      bestStreak
    }
  };
}

// 计算学习进步指标
function calculateLearningMetrics(completedRuns) {
  if (completedRuns.length < 5) {
    return {
      learningRate: 0,
      improvementTrend: 'insufficient_data',
      plateauDetection: false
    };
  }
  
  // 按时间排序（从旧到新）
  const sortedRuns = [...completedRuns].sort((a, b) => (a.time || 0) - (b.time || 0));
  const times = sortedRuns.map(run => run.finish);
  
  // 计算学习率（时间减少的速率）
  let totalImprovement = 0;
  let improvementCount = 0;
  
  for (let i = 1; i < times.length; i++) {
    if (times[i] < times[i-1]) {
      totalImprovement += (times[i-1] - times[i]) / times[i-1];
      improvementCount++;
    }
  }
  
  const learningRate = improvementCount > 0 ? totalImprovement / improvementCount : 0;
  
  // 检测瓶颈期（最近10次运行进步缓慢）
  const recentRuns = sortedRuns.slice(-10);
  if (recentRuns.length >= 5) {
    const recentTimes = recentRuns.map(run => run.finish);
    const recentMean = recentTimes.reduce((a, b) => a + b) / recentTimes.length;
    const earlierRuns = sortedRuns.slice(-20, -10);
    
    let plateauDetection = false;
    if (earlierRuns.length >= 5) {
      const earlierTimes = earlierRuns.map(run => run.finish);
      const earlierMean = earlierTimes.reduce((a, b) => a + b) / earlierTimes.length;
      
      // 如果最近10次平均时间相比前10次进步小于2%，认为进入瓶颈
      const improvement = (earlierMean - recentMean) / earlierMean;
      plateauDetection = improvement < 0.02;
    }
    
    // 判断进步趋势
    let improvementTrend = 'stable';
    if (learningRate > 0.05) improvementTrend = 'improving';
    else if (learningRate < -0.02) improvementTrend = 'declining';
    else if (plateauDetection) improvementTrend = 'plateau';
    
    return {
      learningRate: Math.round(learningRate * 100) / 100,
      improvementTrend,
      plateauDetection
    };
  }
  
  return {
    learningRate: Math.round(learningRate * 100) / 100,
    improvementTrend: 'stable',
    plateauDetection: false
  };
}

// 评估运气影响
function assessLuckImpact(runs, baseline) {
  const completedRuns = runs.filter(run => run.finish && run.finish > 0);
  
  if (completedRuns.length < 5) {
    return {
      luckDependency: 0.5,
      performanceSpread: 0,
      outlierFrequency: 0
    };
  }
  
  const finishTimes = completedRuns.map(run => run.finish);
  
  // 计算表现分布范围
  const minTime = Math.min(...finishTimes);
  const maxTime = Math.max(...finishTimes);
  const performanceSpread = (maxTime - minTime) / minTime;
  
  // 计算异常值频率（超出p25-p75范围）
  const p25Ms = parseTimeToMs(baseline.p25);
  const p75Ms = parseTimeToMs(baseline.p75);
  
  const outliers = finishTimes.filter(time => time < p25Ms || time > p75Ms);
  const outlierFrequency = outliers.length / finishTimes.length;
  
  // 运气依赖度：表现分布越广，对运气依赖越高
  const luckDependency = Math.min(1, performanceSpread * 2);
  
  return {
    luckDependency: Math.round(luckDependency * 100) / 100,
    performanceSpread: Math.round(performanceSpread * 100) / 100,
    outlierFrequency: Math.round(outlierFrequency * 100) / 100
  };
}

// 玩家状态分类
function classifyPlayerState(metrics) {
  const { consistency, learningRate, resetEfficiency } = metrics;
  
  if (learningRate > 0.05 && consistency > 0.7) {
    return { state: 'rapid_improvement', confidence: 0.8 };
  } else if (learningRate < 0.01 && consistency > 0.8) {
    return { state: 'stable_expert', confidence: 0.7 };
  } else if (learningRate < -0.02) {
    return { state: 'declining', confidence: 0.6 };
  } else if (consistency < 0.5 && resetEfficiency < 0.3) {
    return { state: 'inefficient_resets', confidence: 0.7 };
  } else if (learningRate < 0.02 && consistency < 0.6) {
    return { state: 'plateau', confidence: 0.6 };
  } else {
    return { state: 'developing', confidence: 0.5 };
  }
}

// 生成分析总结 
function generateAnalysisSummary(playerState, baseline, learningMetrics) {
  const summaries = {
    rapid_improvement: `正处于快速进步期！`,
    stable_expert: `正处于稳定发挥期！`,
    declining: `正处于状态下滑期！`,
    inefficient_resets: `正处于重置策略调整期！`,
    plateau: `正处于瓶颈期！`,
    developing: `正处于稳步发展期！`
  };
  
  return summaries[playerState.state] || "数据分析完成。";
}

function parseTimeToMs(timeStr) {
  if (!timeStr || timeStr === "N/A") return 0;
  
  const parts = timeStr.split(':');
  if (parts.length !== 2) return 0;
  
  const minutes = parseInt(parts[0]);
  const seconds = parseInt(parts[1]);
  
  if (isNaN(minutes) || isNaN(seconds)) return 0;
  
  return (minutes * 60 + seconds) * 1000;
}

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
      "全历史统计": "/getLifetimeStats?name=玩家名",
      "全历史记录": "/getLifetimeRuns?name=玩家名",
      "行为分析": "/getBehaviorAnalysis?name=玩家名",
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
  console.log("  GET  /getLifetimeStats?name=玩家名 - 获取全历史统计");
  console.log("  GET  /getLifetimeRuns?name=玩家名  - 获取全历史运行记录");
  console.log("  GET  /getBehaviorAnalysis?name=玩家名 - 获取行为分析报告");
  console.log("  GET  /health                      - 健康检查");
  console.log("  GET  /cache-status                - 缓存状态");
  console.log("  DELETE /cache                     - 清空缓存");
  console.log("================================================");
});