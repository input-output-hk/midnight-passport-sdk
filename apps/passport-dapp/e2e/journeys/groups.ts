import type { Page } from 'playwright-core';
import type { JourneyHarness } from './types.js';
import { checkFundingInventory } from './funding-inventory.js';
import {
  checkSignedOutLandingHidesWorkspaceNavigationAnd,
  checkSignedOutHomeReturnsFromDemoTools,
  checkOptionalReactStrictModeHostsUsePublicSnapshots,
  checkOptionalLaceWalletHasExplicitReviewSeparate,
  checkHidingActivityBetweenApprovalAndBrowserAccess,
  checkTwoWhiteLabelActivityHostsRenderShared,
} from './presentation.js';
import {
  checkPersistentNavigationKeepsParentPositionsAndDocument,
  checkCompactNavigationDrawerContainsFocusReturnsFocus,
  checkWalletAndAuditDeepLinksSelectPresentation,
  checkLandingOffersBalancedSignUpAndLog,
} from './navigation.js';
import {
  checkSettingsSubmenusPreservePublicDraftsDeepLink,
  checkFourWorkspacesAndAHomeLinkSeparate,
  checkConsistentAccountPageLinksSupportArrowKeyboard,
  checkAccountOperationDeepLinksRestorePresentationOnly,
  checkActivityOwnsProgressResultsAndExplanationsWithout,
  checkMobileActivitySheetContainsFocusAndEscape,
} from './settings.js';
import {
  checkDeclinedIrreversibleCreateHasNoCredentialOr,
  checkBlockingConsentPreventsBackgroundNavigationCancelledAttempt,
  checkMobileOperationToAuditNavigationClosesThe,
  checkEscapeOnTheFirstCeremonyRefusesCredential,
  checkOperationTerminationClosesPendingConsentOverlapAnd,
  checkApprovedMobileAccessRevealsItsPurposeIn,
  checkEachLaterSetupSignatureNeedsNewApproval,
  checkAcknowledgedCreationAndOneExplicitApprovalPer,
} from './ceremonies.js';
import {
  checkAuthenticatedHomeReturnsToBalancesWithoutAn,
  checkStandaloneBuiltInWalletConnectsWithOne,
  checkCombinedLoginHasAnExplicitPurposeReview,
  checkChangingTheHiddenLifetimeAfterLoginConsent,
  checkActiveAccountLoginUsesOneCombinedRequest,
  checkAddressLoginUsesOneCombinedRequestAnd,
  checkLoginThenHoldingsAndBuiltInWallet,
  checkDecliningPRFUnlockPreventsCredentialAccessAnd,
  checkPublicReadsRevealActivityWithoutACeremony,
  checkApprovedDesktopPasskeyAccessRevealsActivityBefore,
  checkRotationReviewAndResult,
  checkNIGHTAndWalletActionsStayReadyWhile,
} from './login.js';
import {
  checkAccountFormsPreserveTheirValuesAcrossTabs,
  checkEarlyFailureBeforeAnyCredentialCeremonyReveals,
  checkBackgroundTelemetryCannotRelabelAFinishedAttempt,
  checkFundTenRejectInvalidRecipientWithdrawOne,
  checkOnePostLockRoutineReauthenticationWarmsThe,
  checkActionReviewExpiryRefusesWithoutSilentlyRequesting,
  checkLockWhileThePreviousWalletStopsDiscards,
  checkPageExitDisposesQuickActionKeysWithout,
  checkCompletedOperationResultsStayInCollapsibleActivity,
  checkDedicatedAuditRendersAndCopiesPublicExchanges,
} from './value.js';
import {
  checkPrepareJoinerRejectMalformedHandoffEnrollOpen,
  checkGrantReviewAndSubmissionRetainTheAdmitted,
  checkIndependentGranteeSpendIdentifiesAndDerivesIts,
  checkSubmittedGrantSpendWithUnsettledRosterPreserves,
  checkDecliningExactIssueExportAndRevokeReviews,
  checkPrepareHolderIssueExportSpendRevokeRefuse,
  checkMockNameLookupAbsenceAndInvalidInput,
  checkCapabilityProofPlanInspectionInvokesNoConnector,
} from './grants.js';
import {
  checkUnknownDepositIDsSurviveNavigationWithNo,
  checkUncertainFundingRetainsTheOriginalRequestID,
  checkUncertainWithdrawalIsNotAutomaticallyReplayed,
  checkBalanceServiceOutageLabelsPriorSnapshotsWithout,
} from './uncertainty.js';
import {
  checkReadableSessionScopeDistinguishesDraftSettingsFrom,
  checkConsentedPRFChildSessionSignsWithoutAnother,
  checkCriticalOwnerRotationCannotReuseTheCached,
  checkRealBrowserWebLocksRefuseASecond,
  checkWorkspaceAccountTabNavigationDuringAPending,
  checkImmediateLockDuringSettlementRetainsAConfirmed,
} from './session-approval.js';
import {
  checkDeclinedExactSessionAuthorizationAndRevocationReviews,
  checkLocalLockErasesAuthorityLocallyAndA,
  checkRoutineCacheLockDisposesItsDerivedGrant,
  checkCancelledOrSuccessfulRoutineUnlockAndCache,
  checkPagehideReloadRetainsPublicGrantMetadataWithout,
  checkAbsoluteSessionExpiryDisposesTheSignerAnd,
  checkLostSessionAcknowledgementIsAnUnknownOutcome,
  checkStaleTabCannotBypassOrEraseAn,
  checkLostSessionSpendAcknowledgementBlocksRetryAnd,
  checkUncertainRevocationIsNeverReplayedAndRemains,
} from './session-recovery.js';
import {
  checkFullOwnerEnrollmentIsExplicitDecliningCreates,
  checkAuthenticatedOwnerPublicKeyDisclosureFitsThe,
  checkAuthenticatedOwnerHoldingsAndBuiltInWallet,
  checkDecliningFreshCriticalApprovalWhileAnOwner,
  checkMatchingBoundedWithdrawalStaysPasskeyFreeEven,
  checkGrantIssueAndRevocationEachRequireOne,
  checkCachedJubJubOwnerUsesFreshApprovalFor,
  checkExpiredFullOwnerApprovalCannotFallBack,
  checkReauthenticationRestoresTheSameOwnerWithoutEnrollment,
} from './owner-actions.js';
import {
  checkConfirmedOwnerScenarioRetainsItsOriginalReceipt,
  checkIntermediateKeySwitchSubmissionSurvivesALater,
  checkPrivateHoldingsArrivingAfterOwnerLockAre,
  checkReceiptQuotaRefusesNewOwnerWorkBut,
  checkReceiptPersistenceFailureLocksBothLocalKey,
} from './owner-receipts.js';
export async function runPresentation(h: JourneyHarness) {
  const scope0 = { ...(await checkSignedOutLandingHidesWorkspaceNavigationAnd(h)) };
  await checkSignedOutHomeReturnsFromDemoTools(h, scope0);
  await checkOptionalReactStrictModeHostsUsePublicSnapshots(h, scope0);
  await checkOptionalLaceWalletHasExplicitReviewSeparate(h, scope0);
  await checkHidingActivityBetweenApprovalAndBrowserAccess(h, scope0);
  await checkTwoWhiteLabelActivityHostsRenderShared(h, scope0);
  await checkPersistentNavigationKeepsParentPositionsAndDocument(h, scope0);
  await checkCompactNavigationDrawerContainsFocusReturnsFocus(h, scope0);
  await checkWalletAndAuditDeepLinksSelectPresentation(h, scope0);
  await checkLandingOffersBalancedSignUpAndLog(h, scope0);
  await checkSettingsSubmenusPreservePublicDraftsDeepLink(h, scope0);
  await checkFourWorkspacesAndAHomeLinkSeparate(h, scope0);
  await checkConsistentAccountPageLinksSupportArrowKeyboard(h, scope0);
  await checkAccountOperationDeepLinksRestorePresentationOnly(h, scope0);
  await checkActivityOwnsProgressResultsAndExplanationsWithout(h, scope0);
  await checkMobileActivitySheetContainsFocusAndEscape(h, scope0);
  return { owner: scope0.owner };
}

export async function runAccountActions(h: JourneyHarness, input: { owner: Page }) {
  await checkDeclinedIrreversibleCreateHasNoCredentialOr(h, input);
  await checkBlockingConsentPreventsBackgroundNavigationCancelledAttempt(h, input);
  await checkMobileOperationToAuditNavigationClosesThe(h, input);
  const scope0 = { ...input, ...(await checkEscapeOnTheFirstCeremonyRefusesCredential(h, input)) };
  await checkOperationTerminationClosesPendingConsentOverlapAnd(h, scope0);
  await checkApprovedMobileAccessRevealsItsPurposeIn(h, scope0);
  await checkEachLaterSetupSignatureNeedsNewApproval(h, scope0);
  await checkAcknowledgedCreationAndOneExplicitApprovalPer(h, scope0);
  await checkAuthenticatedHomeReturnsToBalancesWithoutAn(h, scope0);
  await checkStandaloneBuiltInWalletConnectsWithOne(h, scope0);
  await checkCombinedLoginHasAnExplicitPurposeReview(h, scope0);
  const scope1 = {
    ...scope0,
    ...(await checkChangingTheHiddenLifetimeAfterLoginConsent(h, scope0)),
  };
  await checkActiveAccountLoginUsesOneCombinedRequest(h, scope1);
  await checkAddressLoginUsesOneCombinedRequestAnd(h, scope1);
  await checkLoginThenHoldingsAndBuiltInWallet(h, scope1);
  await checkDecliningPRFUnlockPreventsCredentialAccessAnd(h, scope1);
  await checkPublicReadsRevealActivityWithoutACeremony(h, scope1);
  await checkApprovedDesktopPasskeyAccessRevealsActivityBefore(h, scope1);
  await checkRotationReviewAndResult(h, scope1);
  await checkNIGHTAndWalletActionsStayReadyWhile(h, scope1);
  const scope2 = {
    ...scope1,
    ...(await checkAccountFormsPreserveTheirValuesAcrossTabs(h, scope1)),
  };
  const scope3 = {
    ...scope2,
    ...(await checkEarlyFailureBeforeAnyCredentialCeremonyReveals(h, scope2)),
  };
  await checkBackgroundTelemetryCannotRelabelAFinishedAttempt(h, scope3);
  await checkFundTenRejectInvalidRecipientWithdrawOne(h, scope3);
  await checkOnePostLockRoutineReauthenticationWarmsThe(h, scope3);
  await checkActionReviewExpiryRefusesWithoutSilentlyRequesting(h, scope3);
  await checkLockWhileThePreviousWalletStopsDiscards(h, scope3);
  await checkPageExitDisposesQuickActionKeysWithout(h, scope3);
  await checkCompletedOperationResultsStayInCollapsibleActivity(h, scope3);
  await checkDedicatedAuditRendersAndCopiesPublicExchanges(h, scope3);
  const scope4 = {
    ...scope3,
    ...(await checkPrepareJoinerRejectMalformedHandoffEnrollOpen(h, scope3)),
  };
  const scope5 = {
    ...scope4,
    ...(await checkGrantReviewAndSubmissionRetainTheAdmitted(h, scope4)),
  };
  await checkIndependentGranteeSpendIdentifiesAndDerivesIts(h, scope5);
  await checkSubmittedGrantSpendWithUnsettledRosterPreserves(h, scope5);
  await checkDecliningExactIssueExportAndRevokeReviews(h, scope5);
  await checkPrepareHolderIssueExportSpendRevokeRefuse(h, scope5);
  const scope6 = { ...scope5, ...(await checkMockNameLookupAbsenceAndInvalidInput(h, scope5)) };
  await checkCapabilityProofPlanInspectionInvokesNoConnector(h, scope6);
  const scope7 = { ...scope6, ...(await checkUnknownDepositIDsSurviveNavigationWithNo(h, scope6)) };
  await checkUncertainFundingRetainsTheOriginalRequestID(h, scope7);
  await checkUncertainWithdrawalIsNotAutomaticallyReplayed(h, scope7);
  await checkFundingInventory(h);
  await checkBalanceServiceOutageLabelsPriorSnapshotsWithout(h, scope7);
  return { owner: scope7.owner, recipient: scope7.recipient, handoff: scope7.handoff };
}

export async function runScopedSessions(
  h: JourneyHarness,
  input: { owner: Page; recipient: string },
) {
  const scope0 = {
    ...input,
    ...(await checkReadableSessionScopeDistinguishesDraftSettingsFrom(h, input)),
  };
  await checkConsentedPRFChildSessionSignsWithoutAnother(h, scope0);
  await checkCriticalOwnerRotationCannotReuseTheCached(h, scope0);
  const scope1 = { ...scope0, ...(await checkRealBrowserWebLocksRefuseASecond(h, scope0)) };
  await checkWorkspaceAccountTabNavigationDuringAPending(h, scope1);
  await checkImmediateLockDuringSettlementRetainsAConfirmed(h, scope1);
  await checkDeclinedExactSessionAuthorizationAndRevocationReviews(h, scope1);
  await checkLocalLockErasesAuthorityLocallyAndA(h, scope1);
  await checkRoutineCacheLockDisposesItsDerivedGrant(h, scope1);
  await checkCancelledOrSuccessfulRoutineUnlockAndCache(h, scope1);
  await checkPagehideReloadRetainsPublicGrantMetadataWithout(h, scope1);
  await checkAbsoluteSessionExpiryDisposesTheSignerAnd(h, scope1);
  await checkLostSessionAcknowledgementIsAnUnknownOutcome(h, scope1);
  const scope2 = { ...scope1, ...(await checkStaleTabCannotBypassOrEraseAn(h, scope1)) };
  await checkLostSessionSpendAcknowledgementBlocksRetryAnd(h, scope2);
  await checkUncertainRevocationIsNeverReplayedAndRemains(h, scope2);
}

export async function runOwnerSafety(
  h: JourneyHarness,
  input: { handoff: string; recipient: string },
) {
  const scope0 = { ...input, ...(await checkFullOwnerEnrollmentIsExplicitDecliningCreates(h)) };
  const scope1 = {
    ...scope0,
    ...(await checkAuthenticatedOwnerPublicKeyDisclosureFitsThe(h, scope0)),
  };
  const scope2 = {
    ...scope1,
    ...(await checkAuthenticatedOwnerHoldingsAndBuiltInWallet(h, scope1)),
  };
  await checkDecliningFreshCriticalApprovalWhileAnOwner(h, scope2);
  await checkMatchingBoundedWithdrawalStaysPasskeyFreeEven(h, scope2);
  await checkGrantIssueAndRevocationEachRequireOne(h, scope2);
  await checkCachedJubJubOwnerUsesFreshApprovalFor(h, scope2);
  const scope3 = { ...scope2, ...(await checkExpiredFullOwnerApprovalCannotFallBack(h, scope2)) };
  await checkReauthenticationRestoresTheSameOwnerWithoutEnrollment(h, scope3);
  await checkConfirmedOwnerScenarioRetainsItsOriginalReceipt(h, scope3);
  await checkIntermediateKeySwitchSubmissionSurvivesALater(h, scope3);
  await checkPrivateHoldingsArrivingAfterOwnerLockAre(h, scope3);
  await checkReceiptQuotaRefusesNewOwnerWorkBut(h, scope3);
  await checkReceiptPersistenceFailureLocksBothLocalKey(h, scope3);
}
