export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-License-Key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { url, method = 'GET', headers = {}, body = null, config = {} } = req.body || {};

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Load test configuration
    const totalRequests = Math.min(parseInt(config.totalRequests) || 100, 1000); // Max 1000
    const concurrency = Math.min(parseInt(config.concurrency) || 10, 100); // Max 100
    const delay = Math.max(parseInt(config.delay) || 0, 0); // Delay between batches (ms)
    const timeout = Math.min(parseInt(config.timeout) || 30000, 60000); // Max 60s

    // Validate URL format
    let targetUrl;
    try {
      targetUrl = new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Results tracking
    const results = [];
    const statusCodes = {};
    const errors = [];
    let completedRequests = 0;
    let failedRequests = 0;

    const startTime = Date.now();

    // Run load test
    const batches = Math.ceil(totalRequests / concurrency);

    for (let batch = 0; batch < batches; batch++) {
      const batchSize = Math.min(concurrency, totalRequests - completedRequests);
      const batchPromises = [];

      for (let i = 0; i < batchSize; i++) {
        const requestStart = Date.now();
        const requestPromise = makeRequest(targetUrl.href, method, headers, body, timeout)
          .then(response => {
            const responseTime = Date.now() - requestStart;
            completedRequests++;
            results.push(responseTime);
            statusCodes[response.status] = (statusCodes[response.status] || 0) + 1;
            return { success: true, status: response.status, time: responseTime };
          })
          .catch(error => {
            failedRequests++;
            completedRequests++;
            const errorMsg = error.message || 'Unknown error';
            errors.push(errorMsg);
            return { success: false, error: errorMsg };
          });

        batchPromises.push(requestPromise);
      }

      await Promise.all(batchPromises);

      // Delay between batches
      if (delay > 0 && batch < batches - 1) {
        await sleep(delay);
      }
    }

    const totalTime = Date.now() - startTime;

    // Calculate statistics
    const stats = calculateStatistics(results, totalTime, totalRequests);

    return res.status(200).json({
      success: true,
      summary: {
        url: targetUrl.href,
        method,
        totalRequests,
        concurrency,
        completedRequests,
        failedRequests,
        totalTime,
        requestsPerSecond: (completedRequests / (totalTime / 1000)).toFixed(2)
      },
      timing: stats,
      statusCodes,
      errors: errors.length > 0 ? errors.slice(0, 10) : [], // Limit error details
      errorCount: errors.length
    });

  } catch (error) {
    console.error('[ERROR] Load test failed:', error);
    return res.status(500).json({ error: 'Load test failed: ' + error.message });
  }
};

async function makeRequest(url, method, headers, body, timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const options = {
      method,
      headers: {
        'User-Agent': 'HTTP-Load-Tester-Pro/1.0',
        ...headers
      },
      signal: controller.signal
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      options.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetch(url, options);
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function calculateStatistics(responseTimes, totalTime, totalRequests) {
  if (responseTimes.length === 0) {
    return {
      avg: 0,
      min: 0,
      max: 0,
      p50: 0,
      p95: 0,
      p99: 0
    };
  }

  const sorted = [...responseTimes].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / sorted.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  // Percentile calculation
  const p50 = getPercentile(sorted, 50);
  const p95 = getPercentile(sorted, 95);
  const p99 = getPercentile(sorted, 99);

  return {
    avg: Math.round(avg),
    min: Math.round(min),
    max: Math.round(max),
    p50: Math.round(p50),
    p95: Math.round(p95),
    p99: Math.round(p99)
  };
}

function getPercentile(sortedArray, percentile) {
  const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
  return sortedArray[Math.max(0, index)];
}
