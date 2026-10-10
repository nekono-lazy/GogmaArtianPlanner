import { existsSync } from 'node:fs'
import { configDefaults, defineConfig } from 'vitest/config'

/**
 * Domain unit tests run in the plain Node environment (Issue #142).
 *
 * `src/domain` is the pure calculation layer: it depends on neither React,
 * the DOM nor IndexedDB (`AGENTS.md` Architecture Rules), and its tests use no
 * DOM API. Creating a jsdom window and loading the React Testing Library
 * setup for each of those files cost far more than the tests themselves, so
 * they skip it.
 */
const domainTestFiles = ['src/domain/**/*.test.ts']

/**
 * Audited non-Domain test files that also run in the Node environment
 * (Issue #142 Phase 2-A, `docs/ISSUE_142_TEST_RUNTIME_RESEARCH.md` 11).
 *
 * Each file was checked, together with everything it imports, to use no DOM,
 * Testing Library or jest-dom API and to reach no browser feature detection
 * that resolves differently under Node (`Worker` is undefined in both
 * environments, and the Worker client tests stub it explicitly). This is an
 * explicit list on purpose: a new test file stays in jsdom until it is audited
 * and added here, so no test silently changes its execution path. Tests that
 * need the browser - for example `importExportService.test.ts`
 * (`localStorage`) and `appVersionChecker.test.ts` (`document`) - stay in jsdom.
 */
const auditedNodeTestFiles = [
  'src/db/AppDatabase.test.ts',
  'src/db/appSettingsCandidateSearchDefaultsMigration.test.ts',
  'src/db/conflictRepairLineageMigration.test.ts',
  'src/db/draftProductionPlanMigration.test.ts',
  'src/db/executionLifecycleMigration.test.ts',
  'src/db/identificationProvenanceMigration.test.ts',
  'src/db/ownedWeaponStatusMigration.test.ts',
  'src/db/preferredOwnedWeaponMigration.test.ts',
  'src/db/productionPlanLifecycleMigration.test.ts',
  'src/db/repositories/executionSavePointRepository.test.ts',
  'src/db/repositories/repositories.integration.test.ts',
  'src/db/settingsRepository.test.ts',
  'src/db/targetCompromiseMigration.test.ts',
  'src/presentation/labels.test.ts',
  'src/presentation/managementListOrder.test.ts',
  'src/presentation/normalCounterIdentification.test.ts',
  'src/presentation/weaponListFilter.test.ts',
  'src/services/buildList/buildListService.test.ts',
  'src/services/crud/crudIntegration.test.ts',
  'src/services/crud/entityCrudServices.test.ts',
  'src/services/crud/executionLifecycleCrud.test.ts',
  'src/services/crud/preferredOwnedWeaponPersistence.test.ts',
  'src/services/crud/targetWeaponLifecyclePlanBreaking.test.ts',
  'src/services/crud/targetWeaponLifecycleService.test.ts',
  'src/services/dataTransfer/importExportValidation.test.ts',
  'src/services/execution/conflictRepairLineageExecution.test.ts',
  'src/services/execution/executionNavigatorAvailability.test.ts',
  'src/services/execution/persistentReidentificationReminderService.test.ts',
  'src/services/execution/planBreakingChangeGuard.test.ts',
  'src/services/execution/productionPlanAbandonment.test.ts',
  'src/services/execution/productionPlanCompromiseFinish.test.ts',
  'src/services/execution/productionPlanExecutionSavePoint.test.ts',
  'src/services/execution/productionPlanExecutionService.test.ts',
  'src/services/execution/productionPlanOperationCountRecovery.test.ts',
  'src/services/execution/productionPlanReplanAdoption.test.ts',
  'src/services/execution/productionPlanStart.test.ts',
  'src/services/planner/createPlannerInput.test.ts',
  'src/services/planner/plannerResultPersistenceService.alternative.test.ts',
  'src/services/planner/plannerResultPersistenceService.savePoint.test.ts',
  'src/services/planner/plannerResultPersistenceService.test.ts',
  'src/services/planner/plannerRuntimeOptions.test.ts',
  'src/services/planner/plannerWorkerClient.test.ts',
  'src/services/planner/prepareProductionPlanInteraction.test.ts',
  'src/services/rngIdentification/gogmaCounterIdentificationWorkerClient.test.ts',
  'src/services/rngIdentification/identificationAdoptionService.test.ts',
  'src/services/rngIdentification/identificationWizardCoordinator.test.ts',
  'src/services/rngIdentification/multiWorkerSkillIdentificationClient.test.ts',
  'src/services/rngIdentification/normalArtianCounterIdentificationWorkerClient.test.ts',
  'src/services/rngIdentification/productionIdentificationActivation.test.ts',
  'src/services/rngIdentification/productionIdentificationAvailability.test.ts',
  'src/services/rngIdentification/skillIdentificationWorkerClient.test.ts',
  'src/services/rngState/rngStatePersistenceService.test.ts',
  'src/services/search/batchCandidateSearch.test.ts',
  'src/services/search/createCandidateSearchInput.test.ts',
  'src/services/search/searchWorkerClient.test.ts',
]

// A renamed or deleted entry must not linger here unnoticed.
const missingAuditedNodeTestFiles = auditedNodeTestFiles.filter(
  (file) => !existsSync(new URL(file, import.meta.url)),
)
if (missingAuditedNodeTestFiles.length > 0) {
  throw new Error(`vitest.config.ts lists missing Node test files: ${missingAuditedNodeTestFiles.join(', ')}`)
}

// Every other test file - React components and pages, the remaining Services,
// Workers, stores, benchmarks, research and scripts - keeps the jsdom
// environment and the full setup unchanged.
const nodeEnvironmentTestFiles = [...domainTestFiles, ...auditedNodeTestFiles]

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: nodeEnvironmentTestFiles,
          setupFiles: ['./src/test/setup.node.ts'],
        },
      },
      {
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          exclude: [...configDefaults.exclude, ...nodeEnvironmentTestFiles],
          setupFiles: ['./src/test/setup.ts'],
        },
      },
    ],
  },
})
