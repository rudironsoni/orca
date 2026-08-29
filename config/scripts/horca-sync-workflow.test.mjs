import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const workflow = parse(readFileSync('.github/workflows/horca_sync.yml', 'utf8'))

describe('Horca sync workflow', () => {
  it('accepts a pre-resolved maintenance candidate', () => {
    const candidateInput = workflow.on.workflow_dispatch.inputs.candidate_ref
    const inspectStep = workflow.jobs.candidate.steps.find(
      (step) => step.name === 'Inspect patch stack'
    )

    expect(candidateInput.required).toBe(false)
    expect(candidateInput.type).toBe('string')
    expect(inspectStep.env.CANDIDATE_REF).toBe('${{ inputs.candidate_ref }}')
    expect(inspectStep.run).toContain('git check-ref-format --branch "$CANDIDATE_REF"')
    expect(inspectStep.run).toContain('git merge-base --is-ancestor upstream/main "$candidate_sha"')
  })

  it('uses the maintenance App for branches that contain workflow changes', () => {
    const candidateJob = workflow.jobs.candidate
    const tokenStep = candidateJob.steps.find((step) => step.name === 'Create maintenance token')
    const checkoutStep = candidateJob.steps.find((step) =>
      step.uses?.startsWith('actions/checkout@')
    )

    expect(candidateJob.environment).toBe('horca-maintenance')
    expect(tokenStep.with['app-id']).toBe('${{ secrets.HORCA_APP_ID }}')
    expect(checkoutStep.with.token).toBe('${{ steps.app.outputs.token }}')
  })
})
