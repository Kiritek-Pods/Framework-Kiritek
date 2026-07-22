"use strict";

const fs = require("fs");
const path = require("path");

function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

const DETECTORS = {
  "java-spring": (cwd) => {
    const pom = readIfExists(path.join(cwd, "pom.xml"));
    if (pom && /spring-boot/.test(pom)) return true;
    const gradle =
      readIfExists(path.join(cwd, "build.gradle")) ||
      readIfExists(path.join(cwd, "build.gradle.kts"));
    if (gradle && /org\.springframework\.boot/.test(gradle)) return true;
    return false;
  },
  flutter: (cwd) => {
    const pubspec = readIfExists(path.join(cwd, "pubspec.yaml"));
    if (!pubspec) return false;
    return /^\s*flutter:\s*$/m.test(pubspec) || /sdk:\s*flutter/.test(pubspec);
  },
  python: (cwd) => {
    return (
      exists(path.join(cwd, "requirements.txt")) ||
      exists(path.join(cwd, "pyproject.toml")) ||
      exists(path.join(cwd, "Pipfile"))
    );
  },
  express: (cwd) => hasDependency(cwd, "express"),
  react: (cwd) => hasDependency(cwd, "react"),
  vue: (cwd) => hasDependency(cwd, "vue"),
};

function hasDependency(cwd, pkgName) {
  const pkgJson = readIfExists(path.join(cwd, "package.json"));
  if (!pkgJson) return false;
  let pkg;
  try {
    pkg = JSON.parse(pkgJson);
  } catch {
    return false;
  }
  return Boolean(
    (pkg.dependencies && pkg.dependencies[pkgName]) ||
      (pkg.devDependencies && pkg.devDependencies[pkgName])
  );
}

/**
 * @param {string} cwd
 * @returns {string[]} nombres de stack detectados (coinciden con templates/stacks/<nombre>)
 */
function detectStacks(cwd) {
  return Object.keys(DETECTORS).filter((stack) => {
    try {
      return DETECTORS[stack](cwd);
    } catch {
      return false;
    }
  });
}

const KNOWN_STACKS = Object.keys(DETECTORS);

module.exports = { detectStacks, KNOWN_STACKS };
