function injectConfirmStyles() {
  if (document.getElementById('ti-confirm-styles')) return;
  const style = document.createElement('style');
  style.id = 'ti-confirm-styles';
  style.textContent = `
    .ti-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.5);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 999999;
      display: flex; align-items: center; justify-content: center;
      animation: tiFadeIn 0.2s ease;
    }
    .ti-confirm-box {
      background: var(--bg-card, #161b22);
      border: 1px solid var(--border, rgba(255,255,255,0.1));
      border-radius: var(--radius-md, 10px);
      box-shadow: 0 12px 32px rgba(0,0,0,0.3);
      width: 340px;
      max-width: 90%;
      overflow: hidden;
      text-align: left;
      animation: tiScaleUp 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    .ti-confirm-header {
      padding: 16px 20px 8px;
      font-weight: 600;
      font-size: 15px;
      color: var(--text-primary, #fff);
    }
    .ti-confirm-body {
      padding: 0 20px 20px;
      font-size: 13px;
      color: var(--text-secondary, #aaa);
      line-height: 1.5;
    }
    .ti-confirm-footer {
      display: flex; gap: 8px; justify-content: flex-end;
      padding: 12px 20px;
      background: var(--bg-secondary, rgba(255,255,255,0.02));
      border-top: 1px solid var(--border, rgba(255,255,255,0.1));
    }
    @keyframes tiFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes tiScaleUp { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  `;
  document.head.appendChild(style);
}

export function customConfirm(message, title = 'Confirm', confirmText = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    injectConfirmStyles();
    const overlay = document.createElement('div');
    overlay.className = 'ti-overlay';
    
    const btnClass = danger ? 'btn btn-danger-solid' : 'btn btn-primary';
    
    overlay.innerHTML = `
      <div class="ti-confirm-box">
        <div class="ti-confirm-header">${title}</div>
        <div class="ti-confirm-body">${message}</div>
        <div class="ti-confirm-footer">
          <button class="btn btn-ghost" id="ti-confirm-cancel">Cancel</button>
          <button class="${btnClass}" id="ti-confirm-ok">${confirmText}</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    const close = (result) => {
      overlay.remove();
      resolve(result);
    };
    
    overlay.querySelector('#ti-confirm-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('#ti-confirm-ok').addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
  });
}
