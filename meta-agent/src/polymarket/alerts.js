function formatOpportunity(opp) {
  const severityIcon = { HIGH: '🔥', MEDIUM: '⚡', LOW: '💡' }[opp.severity] || '💡';

  if (opp.type === 'BINARY') {
    return (
      `${severityIcon} *${opp.severity} — Binary Arb*\n` +
      `📋 ${opp.question}\n` +
      `💰 YES ask: $${opp.yesAsk.toFixed(3)} + NO ask: $${opp.noAsk.toFixed(3)} = $${opp.totalCost.toFixed(3)}\n` +
      `📈 Net profit: ${opp.netProfitPct}% | Max shares: ${opp.maxShares}\n` +
      `💵 Max profit: $${opp.maxNetProfit}\n` +
      `🔗 ${opp.url}`
    );
  }

  if (opp.type === 'MULTI_OUTCOME') {
    return (
      `${severityIcon} *${opp.severity} — Multi-Outcome Arb*\n` +
      `📋 ${opp.question}\n` +
      `Σ Prices: ${opp.totalMidSum} (gap: ${opp.gap})\n` +
      `📈 Net profit: ${opp.netProfitPct}%\n` +
      `🔗 ${opp.url}`
    );
  }

  return `${severityIcon} Unknown opportunity type`;
}

function buildScanReport(results) {
  const { opportunities, scanned, highCount, mediumCount, lowCount, timestamp, errors } = results;
  const time = new Date(timestamp).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });

  let msg = `🎯 *Polymarket Arbitrage Report*\n📅 ${time}\n\n`;
  msg += `Markets scanned: ${scanned}\n`;
  msg += `🔥 High: ${highCount} | ⚡ Medium: ${mediumCount} | 💡 Low: ${lowCount}\n\n`;

  if (opportunities.length === 0) {
    msg += `✅ No arbitrage opportunities found right now.`;
    return msg;
  }

  const topOpps = opportunities.slice(0, 5);
  msg += `*Top Opportunities:*\n\n`;
  for (const opp of topOpps) {
    msg += formatOpportunity(opp) + '\n\n';
  }

  if (errors.length > 0) {
    msg += `⚠️ ${errors.length} markets failed to scan.`;
  }

  return msg;
}

function buildHighAlertMessage(opportunities) {
  if (opportunities.length === 0) return null;
  let msg = `🚨 *POLYMARKET ARB ALERT*\n\n${opportunities.length} HIGH opportunity${opportunities.length > 1 ? 'ies' : ''} found!\n\n`;
  for (const opp of opportunities.slice(0, 3)) {
    msg += formatOpportunity(opp) + '\n\n';
  }
  return msg;
}

module.exports = { formatOpportunity, buildScanReport, buildHighAlertMessage };
