function roundPercentage(attended, total) {
  if (!total) {
    return 0;
  }

  return Math.round((attended / total) * 100);
}

function classesNeededToReachThreshold(attended, total, threshold) {
  if (!total) {
    return 0;
  }

  if ((attended / total) * 100 >= threshold) {
    return 0;
  }

  let extra = 0;
  while (((attended + extra) / (total + extra)) * 100 < threshold) {
    extra += 1;
  }

  return extra;
}

function statusFromPercentage(percentage, threshold) {
  if (percentage < threshold - 10) {
    return "critical";
  }

  if (percentage < threshold) {
    return "warning";
  }

  return "healthy";
}

module.exports = {
  roundPercentage,
  classesNeededToReachThreshold,
  statusFromPercentage
};
