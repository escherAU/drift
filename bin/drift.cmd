@echo off
rem Shim: finds its own folder, then runs drift.js with node.
node "%~dp0drift.js" %*
