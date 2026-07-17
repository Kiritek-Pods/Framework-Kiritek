"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { detectStacks, KNOWN_STACKS } = require("../src/detect.js");

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiritek-detect-"));
}

test("detecta java-spring por pom.xml con spring-boot", () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, "pom.xml"), "<project><artifactId>spring-boot-starter</artifactId></project>");
  assert.deepEqual(detectStacks(dir), ["java-spring"]);
});

test("no detecta java-spring con pom.xml sin spring-boot", () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, "pom.xml"), "<project><artifactId>quarkus</artifactId></project>");
  assert.deepEqual(detectStacks(dir), []);
});

test("detecta flutter por pubspec.yaml con sdk: flutter", () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, "pubspec.yaml"), "name: app\ndependencies:\n  flutter:\n    sdk: flutter\n");
  assert.deepEqual(detectStacks(dir), ["flutter"]);
});

test("detecta python por pyproject.toml", () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, "pyproject.toml"), "[project]\nname = 'app'\n");
  assert.deepEqual(detectStacks(dir), ["python"]);
});

test("detecta multi-stack (java-spring + python) sin conflicto", () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, "pom.xml"), "<project><artifactId>spring-boot-starter</artifactId></project>");
  fs.writeFileSync(path.join(dir, "requirements.txt"), "fastapi\n");
  assert.deepEqual(detectStacks(dir).sort(), ["java-spring", "python"]);
});

test("detecta express por package.json con dependencia express", () => {
  const dir = tmpProject();
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ dependencies: { express: "^4.19.0" } })
  );
  assert.deepEqual(detectStacks(dir), ["express"]);
});

test("detecta react por package.json con dependencia react", () => {
  const dir = tmpProject();
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ dependencies: { react: "^18.3.0", "react-dom": "^18.3.0" } })
  );
  assert.deepEqual(detectStacks(dir), ["react"]);
});

test("detecta express + react juntos (full-stack JS)", () => {
  const dir = tmpProject();
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ dependencies: { express: "^4.19.0", react: "^18.3.0" } })
  );
  assert.deepEqual(detectStacks(dir).sort(), ["express", "react"]);
});

test("package.json sin express/react no detecta esos stacks", () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { lodash: "^4.0.0" } }));
  assert.deepEqual(detectStacks(dir), []);
});

test("proyecto vacío no detecta nada", () => {
  const dir = tmpProject();
  assert.deepEqual(detectStacks(dir), []);
});

test("KNOWN_STACKS coincide con carpetas de templates/stacks", () => {
  const stacksDir = path.join(__dirname, "..", "templates", "stacks");
  const folders = fs.readdirSync(stacksDir).sort();
  assert.deepEqual(KNOWN_STACKS.sort(), folders);
});
