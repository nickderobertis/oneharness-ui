export type Scalar = ReturnType<typeof import('./validation.mjs').scalar>;
export type Classification = ReturnType<typeof import('./validation.mjs').classification>;
export type Matrix = ReturnType<typeof import('./validation.mjs').matrix>;
export type MatrixRow = Record<string, Scalar>;
export type Job = ReturnType<typeof import('./validation.mjs').job>;
export type Workflow = ReturnType<typeof import('./validation.mjs').workflow>;
export type Scenario = ReturnType<typeof import('./validation.mjs').scenario>;
export type RunRow = ReturnType<typeof import('./validation.mjs').runRow>;
export type Run = ReturnType<typeof import('./validation.mjs').workflowRun>;
export type LifecycleRun = ReturnType<typeof import('./validation.mjs').lifecycleRun>;
export type Telemetry = ReturnType<typeof import('./validation.mjs').telemetry>;
export interface JobResult { result: string; outputs: Record<string, string> }
export interface Context { github?: unknown; inputs?: Record<string, Scalar>; matrix?: MatrixRow; steps?: Record<string, { outputs: Record<string, string> }>; needs?: Record<string, JobResult> }
