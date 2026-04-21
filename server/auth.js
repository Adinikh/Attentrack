const jwt = require("jsonwebtoken");

const AUTH_COOKIE = "attendtrack_token";
const JWT_SECRET = process.env.JWT_SECRET || "attendtrack-dev-secret-change-me";
const JWT_EXPIRES_IN = "8h";

function signAuthToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      fullName: user.full_name || user.fullName,
      email: user.email
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 8
  });
}

function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE);
}

function attachUser(req, res, next) {
  const token = req.cookies?.[AUTH_COOKIE];
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: decoded.sub,
      role: decoded.role,
      fullName: decoded.fullName,
      email: decoded.email
    };
  } catch (error) {
    req.user = null;
    clearAuthCookie(res);
  }

  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Please log in to continue." });
  }

  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Please log in to continue." });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have access to this area." });
    }

    next();
  };
}

module.exports = {
  attachUser,
  clearAuthCookie,
  requireAuth,
  requireRole,
  setAuthCookie,
  signAuthToken
};
