// ── Dashboard Frontend ─────────────────────────────────────────────────────
// Uses Server-Sent Events for real-time updates

(function () {
  'use strict';

  // ── Chart setup ─────────────────────────────────────────────────────────
  const ctx = document.getElementById('metricsChart').getContext('2d');
  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Audio Latency (ms)',
          data: [],
          borderColor: 'rgb(168, 85, 247)',
          backgroundColor: 'rgba(168, 85, 247, 0.1)',
          tension: 0.3,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      animation: { duration: 300 },
      plugins: { legend: { labels: { color: '#9ca3af' } } },
      scales: {
        x: { ticks: { color: '#6b7280' }, grid: { color: '#374151' } },
        y: { beginAtZero: true, ticks: { color: '#6b7280' }, grid: { color: '#374151' } },
      },
    },
  });

  // ── SSE connection ──────────────────────────────────────────────────────
  let evtSource = null;
  let selectedCallSid = '';
  let transcriptPollInterval = null;

  function connectSSE() {
    evtSource = new EventSource('/dashboard/stream');

    evtSource.addEventListener('active_calls', (e) => {
      const calls = JSON.parse(e.data);
      updateActiveCalls(calls);
      document.getElementById('stat-active').textContent = calls.length;
    });

    evtSource.addEventListener('metrics', (e) => {
      const data = JSON.parse(e.data);
      updateMetrics(data);
    });

    evtSource.addEventListener('call_history', (e) => {
      const history = JSON.parse(e.data);
      updateCallHistory(history);
    });

    evtSource.onerror = () => {
      document.getElementById('connection-status').innerHTML =
        '<span class="status-dot bg-red-500"></span> Disconnected';
      setTimeout(() => {
        evtSource.close();
        connectSSE();
      }, 3000);
    };

    evtSource.onopen = () => {
      document.getElementById('connection-status').innerHTML =
        '<span class="status-dot status-active"></span> Connected';
    };
  }

  // ── UI updaters ─────────────────────────────────────────────────────────

  function updateActiveCalls(calls) {
    const container = document.getElementById('active-calls-list');
    const selector = document.getElementById('transcript-selector');

    if (calls.length === 0) {
      container.innerHTML = '<p class="text-gray-500 text-sm">No active calls</p>';
      return;
    }

    // Update selector options
    const currentOpts = new Set(Array.from(selector.options).map((o) => o.value));
    calls.forEach((c) => {
      if (!currentOpts.has(c.callSid)) {
        const opt = document.createElement('option');
        opt.value = c.callSid;
        opt.textContent = `${c.phoneNumber || c.callSid}`;
        selector.appendChild(opt);
      }
    });

    container.innerHTML = calls
      .map((call) => {
        const duration = Math.round((Date.now() - new Date(call.startTime).getTime()) / 1000);
        const mins = Math.floor(duration / 60);
        const secs = duration % 60;

        const statusClass =
          call.aiStatus === 'speaking'
            ? 'status-speaking'
            : call.aiStatus === 'processing_tool'
            ? 'status-processing'
            : 'status-active';

        return `
          <div class="border-l-4 border-green-500 pl-4 py-2">
            <div class="flex justify-between items-center">
              <span class="font-medium text-sm">${call.phoneNumber || 'Unknown'}</span>
              <span class="text-xs text-gray-400">${mins}m ${secs}s</span>
            </div>
            <div class="text-xs text-gray-400 mt-1">
              ${call.customerName || 'Collecting info...'} &bull;
              <span class="${statusClass} status-dot"></span>${call.aiStatus} &bull;
              ${call.currentStep}
            </div>
            <button onclick="selectCall('${call.callSid}')" class="text-xs text-blue-400 hover:underline mt-1">View Transcript</button>
          </div>`;
      })
      .join('');
  }

  function updateMetrics(data) {
    const avgLatency = data.avgLatency || 0;
    document.getElementById('stat-latency').textContent = avgLatency > 0 ? `${avgLatency}ms` : '--';

    // Update chart
    const samples = (data.samples || []).reverse();
    chart.data.labels = samples.map((_, i) => i + 1);
    chart.data.datasets[0].data = samples;
    chart.update('none');
  }

  function updateCallHistory(history) {
    const container = document.getElementById('call-history');

    if (history.length === 0) {
      container.innerHTML = '<p class="text-gray-500 text-sm">No call history</p>';
      return;
    }

    container.innerHTML = history
      .map((h) => {
        const date = new Date(h.startTime);
        const timeStr = date.toLocaleTimeString();
        const icon =
          h.outcome === 'appointment_booked' ? '&#x2705;' : h.outcome === 'error' ? '&#x26A0;&#xFE0F;' : '&#x274C;';
        const mins = Math.floor(h.duration / 60);
        const secs = h.duration % 60;

        return `
          <div class="border border-gray-700 rounded p-3">
            <div class="flex justify-between items-start">
              <div>
                <span class="text-sm">${icon} ${h.phoneNumber || 'Unknown'}</span>
                <span class="text-xs text-gray-500 ml-2">${h.customerName || ''}</span>
              </div>
              <span class="text-xs text-gray-500">${timeStr}</span>
            </div>
            <div class="text-xs text-gray-400 mt-1">
              ${h.outcome.replace(/_/g, ' ')} &bull; ${mins}m ${secs}s
              ${h.confirmationNumber ? '&bull; ' + h.confirmationNumber : ''}
            </div>
          </div>`;
      })
      .join('');
  }

  // ── Transcript polling ──────────────────────────────────────────────────

  window.selectCall = function (callSid) {
    selectedCallSid = callSid;
    document.getElementById('transcript-selector').value = callSid;
    startTranscriptPolling(callSid);
  };

  document.getElementById('transcript-selector').addEventListener('change', (e) => {
    const sid = e.target.value;
    if (sid) {
      selectedCallSid = sid;
      startTranscriptPolling(sid);
    }
  });

  function startTranscriptPolling(callSid) {
    if (transcriptPollInterval) clearInterval(transcriptPollInterval);

    const container = document.getElementById('transcript-container');
    container.innerHTML = '<p class="text-gray-500">Loading transcript...</p>';

    const poll = async () => {
      try {
        const res = await fetch(`/dashboard/api/transcripts/${callSid}`);
        const entries = await res.json();
        renderTranscript(entries);
      } catch {
        /* ignore */
      }
    };

    poll();
    transcriptPollInterval = setInterval(poll, 1500);
  }

  function renderTranscript(entries) {
    const container = document.getElementById('transcript-container');

    if (entries.length === 0) {
      container.innerHTML = '<p class="text-gray-500">No messages yet</p>';
      return;
    }

    container.innerHTML = entries
      .map((e) => {
        const time = new Date(e.timestamp).toLocaleTimeString();
        if (e.role === 'user') {
          return `<div class="transcript-user"><span class="text-xs text-gray-500">[${time}]</span> <span class="text-blue-300 font-medium">User:</span> <span class="text-gray-200">${escapeHtml(e.content)}</span></div>`;
        } else if (e.role === 'assistant') {
          return `<div class="transcript-ai"><span class="text-xs text-gray-500">[${time}]</span> <span class="text-green-300 font-medium">AI:</span> <span class="text-gray-200">${escapeHtml(e.content)}</span></div>`;
        } else if (e.role === 'function_call') {
          return `<div class="transcript-fn text-yellow-400">[${time}] &#x1F527; ${escapeHtml(e.content)}</div>`;
        } else if (e.role === 'function_result') {
          return `<div class="transcript-fn text-green-400">[${time}] &#x2705; ${escapeHtml(e.content)}</div>`;
        }
        return '';
      })
      .join('');

    container.scrollTop = container.scrollHeight;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Fetch initial stats ─────────────────────────────────────────────────

  async function fetchStats() {
    try {
      const res = await fetch('/dashboard/api/calls/stats');
      const stats = await res.json();
      document.getElementById('stat-bookings').textContent = stats.todayBookings;
      document.getElementById('stat-success').textContent =
        stats.totalCalls > 0 ? stats.successRate + '%' : '--';
    } catch {
      /* ignore */
    }
  }

  // ── Init ────────────────────────────────────────────────────────────────
  connectSSE();
  fetchStats();
  setInterval(fetchStats, 10000);
})();
