import jwt from 'jsonwebtoken';
import { loadEnvironment, assertRequiredEnvironment } from '../config/env.js';

const environment = loadEnvironment();
assertRequiredEnvironment(environment);

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({
      ok: false,
      message: 'Missing bearer token',
    });
  }

  try {
    const payload = jwt.verify(token, environment.jwtSecret);
    req.auth = {
      userId: payload.sub,
      role: payload.role,
      email: payload.email,
      name: payload.name,
    };
    return next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      message: 'Invalid or expired token',
    });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({
        ok: false,
        message: 'Authentication required',
      });
    }

    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({
        ok: false,
        message: 'You do not have permission to access this resource',
      });
    }

    return next();
  };
}

export function requireOwnership(paramName = 'userId') {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({
        ok: false,
        message: 'Authentication required',
      });
    }

    if (req.auth.role === 'ADMIN') {
      return next();
    }

    if (String(req.params[paramName]) !== String(req.auth.userId)) {
      return res.status(403).json({
        ok: false,
        message: 'You do not have permission to modify this resource',
      });
    }

    return next();
  };
}
