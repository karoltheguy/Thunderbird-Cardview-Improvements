var cardModifier = class extends (ExtensionCommon.ExtensionAPI) {
  getAPI(context) {
    const styleId = "styles-from-add-delete-button-addon";

    function addDynamicCSS(document, id, css) {
      const existing = document.getElementById(id);
      if (existing) {
        existing.remove();
      }
      const style = document.createElement("style");
      style.id = id;
      style.textContent = css;
      document.head.appendChild(style);
    }

    const cssText = `
.thread-card-icon-info {
  position: relative !important;
  bottom: -2px !important;
  right: auto !important;
  top: auto !important;
  margin-left: auto !important;
  margin-top: -6px !important;
  margin-bottom: 0px !important;
  align-self: flex-end !important;

  display: flex !important;
  flex-wrap: nowrap !important;
  gap: 6px !important;
  z-index: 10 !important;

  pointer-events: none !important;
  width: auto !important;
}

/* Adjustments for Compact/2-Line View */
body.qcd-compact-mode .thread-card-icon-info {
  top: 3px !important;
}

/* Fix for Group Headers and Thread Top cards: Center container, hide delete button */
:is(tr, li)[is="thread-group-header"] .thread-card-icon-info,
:is(tr, li)[aria-expanded] .thread-card-icon-info {
  align-self: center !important;
  top: auto !important;
}

/* Hide delete button on Group Headers and Thread Top cards */
:is(tr, li)[is="thread-group-header"] .thread-card-icon-info::after,
:is(tr, li)[aria-expanded] .thread-card-icon-info::after {
  display: none !important;
}

.thread-card-icon-info::after {
  content: "" !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 24px !important;
  height: 24px !important;
  background-image: url("chrome://messenger/skin/icons/delete.svg") !important;
  background-repeat: no-repeat !important;
  background-position: center !important;
  background-size: 16px 16px !important;
  opacity: 0.4 !important;
  cursor: pointer !important;
  transition: all 0.15s ease !important;
  pointer-events: auto !important;
  flex-shrink: 0 !important;
}

.thread-card-icon-info:not(:has(*:hover)):hover::after {
  opacity: 1 !important;
}

.thread-card-icon-info::after:active {
  transform: scale(0.85) !important;
}

.thread-card-icon-info > * {
  pointer-events: auto !important;
}
`;

    async function waitForThreadCards(doc, retries = 10, delay = 200) {
      for (let i = 0; i < retries; i++) {
        if (doc.querySelector(".thread-card-icon-info")) {
          return true;
        }
        await new Promise(r => doc.defaultView.setTimeout(r, delay));
      }
      return false;
    }

    context.callOnClose({
      close() {
        const windows = Array.from(Services.wm.getEnumerator("mail:3pane"));
        // Cleanup all windows.
        for (let window of windows) {
          // Cleanup all mail tabs in the given window.
          for (let nativeTab of window.gTabmail.tabInfo.filter(t => t.mode.name === "mail3PaneTab")) {
            const doc = nativeTab?.chromeBrowser?.contentDocument
            if (!doc) {
              continue;
            }
            const style = doc.getElementById(styleId);
            if (style) {
              style.remove();
            }
            if (doc._quickDeleteHandler) {
              doc.removeEventListener("mousedown", doc._quickDeleteHandler, true);
              delete doc._quickDeleteHandler;
            }
            if (doc._quickDeleteDblHandler) {
              doc.removeEventListener("dblclick", doc._quickDeleteDblHandler, true);
              delete doc._quickDeleteDblHandler;
              delete doc._quickDeleteSuppressUntil;
            }
            if (doc._qcdResizeObserver) {
              doc._qcdResizeObserver.disconnect();
              delete doc._qcdResizeObserver;
              doc.body.classList.remove("qcd-compact-mode");
            }
          }
        }      
      }
    });

    return {
      cardModifier: {
        async add(tabId) {
          let nativeTab = context.extension.tabManager.get(tabId).nativeTab;
          const doc = nativeTab?.chromeBrowser?.contentDocument
          if (!doc) {
            return;
          }

          // Wait until thread cards exist.
          await waitForThreadCards(doc);

          // Stable detection of view density (Compact/2-Line vs Standard)
          // We observe one card to determine the mode for the list.
          // This avoids per-card layout thrashing.
          if (!doc._qcdResizeObserver) {
            doc._qcdResizeObserver = new doc.defaultView.ResizeObserver(entries => {
              if (!entries.length) return;
              const height = entries[0].contentRect.height;
              // Threshold: Standard cards are usually > 55px, Compact < 50px
              if (height < 65) {
                doc.body.classList.add("qcd-compact-mode");
              } else {
                doc.body.classList.remove("qcd-compact-mode");
              }
            });
            const sampleCard = doc.querySelector("tr[is='thread-card'], li[is='thread-card'], tr.thread-card, li.thread-card");
            if (sampleCard) doc._qcdResizeObserver.observe(sampleCard);
          }

          // Apply CSS.
          addDynamicCSS(doc, styleId, cssText);
          // Suppress dblclicks briefly after a quick-delete action to avoid
          // Thunderbird treating rapid clicks across cards as a double-click.
          doc._quickDeleteSuppressUntil = 0;
          doc._quickDeleteDblHandler = (ev) => {
            try {
              if (doc._quickDeleteSuppressUntil && Date.now() < doc._quickDeleteSuppressUntil) {
                ev.preventDefault();
                ev.stopImmediatePropagation();
              }
            } catch (err) {
              // ignore
            }
          };
          doc.addEventListener("dblclick", doc._quickDeleteDblHandler, true);

          doc._quickDeleteHandler = (e) => {
            try {
              const iconContainer = e.target.closest(".thread-card-icon-info");
              if (!iconContainer) return;

              const rect = iconContainer.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              if (clickX < rect.width - 25) return;

              const card = iconContainer.closest("tr, li, thread-card");
              if (!card) return;

              e.preventDefault();
              e.stopImmediatePropagation();

              // Set suppression window to ignore dblclick events that follow
              // quickly (clicks on different cards can otherwise be seen as dblclick).
              doc._quickDeleteSuppressUntil = Date.now() + 450;

              // Perform selection and delete. We keep the synthetic click to keep
              // UI selection behavior but suppress following dblclick events.
              card.click();
              const win = e.target.ownerDocument.defaultView;

              // Try to delete specifically if possible (safer than global command)
              let handled = false;
              const target = card.message || card.messageKey;
              if (win.gFolderDisplay && target) {
                try {
                  let msgHdr = target;
                  if (typeof msgHdr === "number" && win.gFolderDisplay.selectedFolder) {
                    msgHdr = win.gFolderDisplay.selectedFolder.GetMessageHeader(msgHdr);
                  }
                  if (msgHdr) {
                    win.gFolderDisplay.deleteMessages([msgHdr]);
                    handled = true;
                  }
                } catch (ex) {
                  console.error("QuickDelete: Direct delete failed", ex);
                }
              }

              if (!handled) {
                win.setTimeout(() => {
                  try {
                    // Verify selection matches the clicked card before deleting
                    const isActive = win.document.activeElement && win.document.activeElement.closest("tr, li, thread-card") === card;
                    const isSelected = card.classList.contains("selected") || card.getAttribute("aria-selected") === "true";

                    if (isActive || isSelected) {
                      win.goDoCommand("cmd_delete");
                    }
                  } catch (err) {
                    // ignore deletion errors
                  }
                }, 100);
              }
            } catch (err) {
              console.error("Error in quick delete handler:", err);
            }
          };

          doc.addEventListener("mousedown", doc._quickDeleteHandler, true);
        },
      }
    };
  }
};
