// Copyright 2025-2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * @fileoverview Shared flow response transformer utilities for v2 embedded flows.
 *
 * This module provides reusable transformation functions for normalizing embedded flow
 * responses from ThunderID APIs. It handles both successful responses with component
 * extraction and error responses with proper error message extraction.
 *
 * Key features:
 * - Component extraction from flow meta structure
 * - Translation string resolution in components
 * - Error response detection and message extraction
 * - Configurable error handling (throw vs return errors)
 *
 * Usage:
 * ```typescript
 * import { normalizeFlowResponse } from '../../../utils/flowTransformer';
 *
 * const { executionId, components } = normalizeFlowResponse(apiResponse, t, {
 *   defaultErrorKey: 'components.signIn.errors.generic'
 * });
 * ```
 *
 * This transformer is used by both SignIn and SignUp v2 components to ensure
 * consistent response handling across all embedded flows.
 */

import {
  EmbeddedFlowComponent,
  EmbeddedFlowComponentType,
  FlowMetadataResponse,
  I18nMessage,
  hasUnresolvedTranslationParams,
} from '@thunderid/browser';
import resolveTranslationsInArray from './resolveTranslationsInArray';

type TranslationFn = (key: string, params?: Record<string, string | number>) => string;

/**
 * Generic flow error response interface that covers common error structure
 */
export interface FlowErrorResponse {
  error?: {
    code: string;
    description: I18nMessage;
    message: I18nMessage;
  };
  executionId: string;
  flowStatus: 'ERROR';
}

/**
 * Configuration options for flow transformation
 */
export interface FlowTransformOptions {
  /**
   * Default error message key for translation fallback
   * @default 'errors.flow.generic'
   */
  defaultErrorKey?: string;
  /**
   * Whether to resolve translation strings or keep them as i18n keys
   * @default true
   */
  resolveTranslations?: boolean;
  /**
   * Whether to throw errors or return them as normalized response
   * @default true
   */
  throwOnError?: boolean;
}

/**
 * Create a mapping from ref to identifier based on data.inputs array.
 */
const createInputRefMapping = (response: any): Map<string, string> => {
  const mapping: Map<string, string> = new Map<string, string>();

  if (response?.data?.inputs && Array.isArray(response.data.inputs)) {
    response.data.inputs.forEach((input: any) => {
      if (input.ref && input.identifier) {
        mapping.set(input.ref, input.identifier);
      }
    });
  }

  return mapping;
};

/**
 * Create a mapping from ref to prefill value based on data.inputs array.
 * Inputs without a value, and password and OTP inputs, are left out so a secret is never prefilled.
 */
const createInputValueMapping = (response: any): Map<string, string> => {
  const mapping: Map<string, string> = new Map<string, string>();

  if (response?.data?.inputs && Array.isArray(response.data.inputs)) {
    response.data.inputs.forEach((input: any) => {
      if (
        input.ref &&
        typeof input.value === 'string' &&
        input.value !== '' &&
        input.type !== EmbeddedFlowComponentType.PasswordInput &&
        input.type !== EmbeddedFlowComponentType.OtpInput
      ) {
        mapping.set(input.ref, input.value);
      }
    });
  }

  return mapping;
};

/**
 * Create a mapping from action ref to nextNode based on data.actions array.
 */
const createActionRefMapping = (response: any): Map<string, string> => {
  const mapping: Map<string, string> = new Map<string, string>();

  if (response?.data?.actions && Array.isArray(response.data.actions)) {
    response.data.actions.forEach((action: any) => {
      if (action.ref && action.nextNode) {
        mapping.set(action.ref, action.nextNode);
      }
    });
  }

  return mapping;
};

/**
 * Apply input ref mapping to components recursively.
 */
const applyInputRefMapping = (
  components: EmbeddedFlowComponent[],
  refMapping: Map<string, string>,
  actionMapping: Map<string, string>,
  inputsData: any[] = [],
  valueMapping: Map<string, string> = new Map<string, string>(),
): EmbeddedFlowComponent[] =>
  components.map((component: EmbeddedFlowComponent) => {
    const transformedComponent: any = {...component} as EmbeddedFlowComponent & {
      actionRef?: string;
      options?: {label: string; value: string}[];
    };

    // Carry the server-supplied prefill value onto the input component before the ref is replaced.
    if (transformedComponent.ref && valueMapping.has(transformedComponent.ref)) {
      transformedComponent.value = valueMapping.get(transformedComponent.ref);
    }

    if (transformedComponent.ref && refMapping.has(transformedComponent.ref)) {
      transformedComponent.ref = refMapping.get(transformedComponent.ref);
    }

    if (transformedComponent.type === 'SELECT' && component.id) {
      const inputData: any = inputsData.find((input: any) => input.ref === component.id);
      if (inputData?.options) {
        transformedComponent.options = inputData.options.map((opt: any) => {
          if (typeof opt === 'string') {
            return {label: opt, value: opt};
          }
          const value: string = typeof opt.value === 'object' ? JSON.stringify(opt.value) : String(opt.value || '');
          const label: string = typeof opt.label === 'object' ? JSON.stringify(opt.label) : String(opt.label || value);

          return {label, value};
        });
      }
    }

    if (
      transformedComponent.type === 'ACTION' &&
      transformedComponent.id &&
      actionMapping.has(transformedComponent.id)
    ) {
      transformedComponent.actionRef = actionMapping.get(transformedComponent.id);
    }

    if (transformedComponent.components && Array.isArray(transformedComponent.components)) {
      transformedComponent.components = applyInputRefMapping(
        transformedComponent.components,
        refMapping,
        actionMapping,
        inputsData,
        valueMapping,
      );
    }

    return transformedComponent;
  });

/**
 * Transform and resolve translations in components from flow response.
 */
export const transformComponents = (
  response: any,
  t: TranslationFn,
  resolveTranslations = true,
  meta?: FlowMetadataResponse | null,
): EmbeddedFlowComponent[] => {
  if (!response?.data?.meta?.components) {
    return [];
  }

  let {components} = response.data.meta;

  const refMapping: Map<string, string> = createInputRefMapping(response);
  const actionMapping: Map<string, string> = createActionRefMapping(response);
  const valueMapping: Map<string, string> = createInputValueMapping(response);
  const inputsData: any[] = response?.data?.inputs || [];

  if (refMapping.size > 0 || actionMapping.size > 0 || inputsData.length > 0) {
    components = applyInputRefMapping(components, refMapping, actionMapping, inputsData, valueMapping);
  }

  return resolveTranslations ? resolveTranslationsInArray(components, t, undefined, meta) : components;
};

/**
 * Collect the prefill values carried by input components, keyed by the component ref.
 */
export const collectPrefillValues = (components: EmbeddedFlowComponent[]): Record<string, string> => {
  const values: Record<string, string> = {};

  components.forEach((component: EmbeddedFlowComponent) => {
    if (component.ref && component.value) {
      values[component.ref] = component.value;
    }

    if (component.components) {
      Object.assign(values, collectPrefillValues(component.components));
    }
  });

  return values;
};

/**
 * Extract error message from flow error response.
 *
 * Resolution order:
 * 1. Structured `error` object: try i18n lookup via `t(error.message.key, error.message.params)`.
 *    Bundle entries keep the backend's `{{param(name)}}` placeholders, so `params` must be passed
 *    through; a resolved value that still holds an unsubstituted placeholder is treated as a miss.
 * 2. Fallback to `defaultValue` from `message`, then `description` (the backend pre-substitutes it).
 * 3. Standard `Error.message`.
 * 4. Generic translated fallback via `defaultErrorKey`.
 */
export const extractErrorMessage = (
  error: FlowErrorResponse | any,
  t: TranslationFn,
  defaultErrorKey = 'errors.flow.generic',
): string => {
  if (error && typeof error === 'object' && error.error) {
    const flowError: FlowErrorResponse['error'] = error.error;

    // 1. Try i18n lookup on message.key first (preferred for user-facing errors)
    if (flowError?.message?.key) {
      const params: Record<string, string> | undefined = flowError.message.params;

      const translated: string = t(flowError.message.key, params);
      if (translated && translated !== flowError.message.key && !hasUnresolvedTranslationParams(translated)) {
        return translated;
      }

      // If the key resolved to itself, retry using the flat key "system.<key>"
      // (e.g. system.${flowError.message.key}) because useI18n().t() performs
      // flat translations and FlowMetaProvider flattens namespaces as `${namespace}.${key}`
      const systemKey = `system.${flowError.message.key}`;
      const systemTranslated: string = t(systemKey, params);
      if (systemTranslated && systemTranslated !== systemKey && !hasUnresolvedTranslationParams(systemTranslated)) {
        return systemTranslated;
      }
    }

    // 2. Fall back to defaultValue from message, then description
    const fallback: string | undefined = flowError?.message?.defaultValue ?? flowError?.description?.defaultValue;
    if (fallback) {
      return fallback;
    }
  }

  // Legacy backward compatibility
  if (error && typeof error === 'object' && error.failureReason) {
    return error.failureReason;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return t(defaultErrorKey);
};

/**
 * Check if a response is an error response and extract the error message.
 */
export const checkForErrorResponse = (
  response: any,
  t: TranslationFn,
  defaultErrorKey = 'errors.flow.generic',
): string | null => {
  if (response?.flowStatus === 'ERROR') {
    return extractErrorMessage(response, t, defaultErrorKey);
  }

  return null;
};

/**
 * Generic flow response normalizer that handles both success and error responses.
 * This is the main transformer function that should be used by all flow components.
 */
export const normalizeFlowResponse = (
  response: any,
  t: TranslationFn,
  options: FlowTransformOptions = {},
  meta?: FlowMetadataResponse | null,
): {
  additionalData: Record<string, any>;
  components: EmbeddedFlowComponent[];
  executionId: string;
} => {
  const {throwOnError = true, defaultErrorKey = 'errors.flow.generic', resolveTranslations = true} = options;

  const errorMessage: string | null = checkForErrorResponse(response, t, defaultErrorKey);

  if (errorMessage && throwOnError) {
    throw response;
  }

  const additionalData: Record<string, any> = (response?.data?.additionalData as Record<string, any>) ?? {};

  if (typeof additionalData['consentPrompt'] === 'string') {
    try {
      const parsed: any = JSON.parse(additionalData['consentPrompt']);
      additionalData['consentPrompt'] = {purposes: Array.isArray(parsed) ? parsed : []};
    } catch {
      // Leave unparseable value as-is
    }
  }

  return {
    additionalData,
    components: transformComponents(response, t, resolveTranslations, meta),
    executionId: response.executionId,
  };
};
