// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

import {cleanup, render} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import I18nProvider from '../../../../../contexts/I18n/I18nProvider';
import ThemeProvider from '../../../../../contexts/Theme/ThemeProvider';
import ThunderIDContext, {ThunderIDContextProps} from '../../../../../contexts/ThunderID/ThunderIDContext';
import BaseSignIn from '../BaseSignIn';

const thunderIDContext: ThunderIDContextProps = {
  isInitialized: true,
  isLoading: false,
  vendor: 'thunderid',
} as unknown as ThunderIDContextProps;

describe('BaseSignIn', () => {
  afterEach(() => {
    cleanup();
  });

  it('exposes the step additionalData to render props', () => {
    const renderChild = vi.fn(() => <div />);

    render(
      <ThunderIDContext.Provider value={thunderIDContext}>
        <I18nProvider>
          <ThemeProvider>
            <BaseSignIn additionalData={{linkingPromptDetails: '[]'}} components={[]} onSubmit={vi.fn()}>
              {renderChild}
            </BaseSignIn>
          </ThemeProvider>
        </I18nProvider>
      </ThunderIDContext.Provider>,
    );

    expect(renderChild).toHaveBeenLastCalledWith(
      expect.objectContaining({additionalData: {linkingPromptDetails: '[]'}}),
    );
  });

  it('seeds the form values from the prefill value of an input component', () => {
    const renderChild = vi.fn(() => <div />);

    render(
      <ThunderIDContext.Provider value={thunderIDContext}>
        <I18nProvider>
          <ThemeProvider>
            <BaseSignIn
              components={[
                {id: 'field_1', ref: 'department', type: 'TEXT_INPUT', value: 'Engineering'},
                {id: 'field_2', ref: 'username', type: 'TEXT_INPUT'},
              ]}
              onSubmit={vi.fn()}
            >
              {renderChild}
            </BaseSignIn>
          </ThemeProvider>
        </I18nProvider>
      </ThunderIDContext.Provider>,
    );

    expect(renderChild).toHaveBeenLastCalledWith(expect.objectContaining({values: {department: 'Engineering'}}));
  });
});
