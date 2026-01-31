import type { OttoPromptAdapter } from "@otto/ports";

import {
  BoxRenderable,
  createCliRenderer,
  InputRenderable,
  InputRenderableEvents,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  type KeyEvent,
} from "@opentui/core";

export class PromptCancelledError extends Error {
  constructor(message = "Prompt cancelled") {
    super(message);
    this.name = "PromptCancelledError";
  }
}

async function runPrompt<T>(
  build: (ctx: {
    renderer: Awaited<ReturnType<typeof createCliRenderer>>;
    resolve: (value: T) => void;
    reject: (err: unknown) => void;
  }) => void,
): Promise<T> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useConsole: false,
    useMouse: false,
    useAlternateScreen: true,
    useKittyKeyboard: {
      disambiguate: true,
      alternateKeys: true,
    },
  });

  renderer.start();

  let done = false;
  const finalize = async () => {
    try {
      renderer.destroy();
    } catch {
      // best-effort
    }
  };

  return await new Promise<T>((outerResolve, outerReject) => {
    const resolve = (value: T) => {
      if (done) return;
      done = true;
      void finalize().finally(() => outerResolve(value));
    };
    const reject = (err: unknown) => {
      if (done) return;
      done = true;
      void finalize().finally(() => outerReject(err));
    };

    const onKeypress = (key: KeyEvent) => {
      if ((key.ctrl && key.name === "c") || key.name === "escape") {
        reject(new PromptCancelledError());
      }
    };

    renderer.keyInput.on("keypress", onKeypress);

    try {
      build({ renderer, resolve, reject });
      renderer.requestRender();
    } catch (err) {
      reject(err);
    }
  });
}

function buildPromptFrame(args: {
  renderer: Awaited<ReturnType<typeof createCliRenderer>>;
  message: string;
}): BoxRenderable {
  const { renderer, message } = args;
  const frame = new BoxRenderable(renderer, {
    width: "100%",
    height: "100%",
    flexDirection: "column",
    padding: 1,
    rowGap: 1,
  });

  frame.add(
    new TextRenderable(renderer, {
      content: message,
      width: "100%",
    }),
  );

  renderer.root.add(frame);
  return frame;
}

export function createOpentuiPromptAdapter(): OttoPromptAdapter {
  return {
    async confirm(message: string, options?: { defaultValue?: boolean }) {
      return await runPrompt<boolean>(({ renderer, resolve }) => {
        const frame = buildPromptFrame({ renderer, message });
        const items = [
          { name: "Yes", description: "", value: true },
          { name: "No", description: "", value: false },
        ];
        const defaultValue = options?.defaultValue;
        const selectedIndex = defaultValue === false ? 1 : 0;

        const select = new SelectRenderable(renderer, {
          width: "100%",
          height: 4,
          options: items,
          selectedIndex,
          showDescription: false,
          wrapSelection: true,
        });

        select.on(SelectRenderableEvents.ITEM_SELECTED, () => {
          resolve(select.getSelectedOption()?.value === true);
        });

        frame.add(select);
        renderer.focusRenderable(select);
      });
    },

    async text(message: string, options?: { defaultValue?: string }) {
      const defaultValue = options?.defaultValue ?? "";
      return await runPrompt<string>(({ renderer, resolve }) => {
        const frame = buildPromptFrame({ renderer, message });
        const input = new InputRenderable(renderer, {
          width: "100%",
          value: defaultValue,
        });

        input.on(InputRenderableEvents.ENTER, () => {
          const value = input.value.trim();
          resolve(value.length > 0 ? value : defaultValue);
        });

        frame.add(input);
        renderer.focusRenderable(input);
      });
    },

    async select(
      message: string,
      options: { choices: string[]; defaultValue?: string },
    ) {
      if (options.choices.length === 0) {
        throw new Error("select() requires at least one choice");
      }

      const defaultIndex =
        typeof options.defaultValue === "string"
          ? Math.max(0, options.choices.indexOf(options.defaultValue))
          : 0;

      return await runPrompt<string>(({ renderer, resolve }) => {
        const frame = buildPromptFrame({ renderer, message });
        const select = new SelectRenderable(renderer, {
          width: "100%",
          height: Math.min(12, options.choices.length + 2),
          options: options.choices.map((c) => ({
            name: c,
            description: "",
            value: c,
          })),
          selectedIndex: defaultIndex,
          showDescription: false,
          wrapSelection: true,
        });

        select.on(SelectRenderableEvents.ITEM_SELECTED, () => {
          resolve(select.getSelectedOption()?.value ?? options.choices[0]);
        });

        frame.add(select);
        renderer.focusRenderable(select);
      });
    },
  };
}
