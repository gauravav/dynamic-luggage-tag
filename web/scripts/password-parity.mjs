// Evaluates the TypeScript password policy port for
// api/tests/test_password_meter_parity.py. Reads cases on stdin, writes the
// rejection message (or null) for each on stdout.
import { policyProblem } from '../src/lib/passwordStrength.ts'

let input = ''
for await (const chunk of process.stdin) input += chunk
const { cases } = JSON.parse(input)
process.stdout.write(JSON.stringify(cases.map(({ password, context }) => policyProblem(password, context))))
