#!/bin/bash
# Runs a job from tools/winbox/jobs in the box's console session (scheduled task) and prints its log.
# Usage: BOX=user@host tools/winbox/mac/wj.sh <task name> <job.ps1> ['<script arguments>']      (TIMEOUT=seconds, default 600)
: "${BOX:?set BOX=user@host}"
NAME=$1; SCRIPT=$2; shift 2
ssh -o BatchMode=yes "$BOX" "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\dev\\run_interactive.ps1 -Name $NAME -ScriptPath C:\\dev\\OpenTheMoviesGame\\tools\\winbox\\jobs\\$SCRIPT -ScriptArgs \"$*\" -Wait -TimeoutSec ${TIMEOUT:-600}" 2>&1
