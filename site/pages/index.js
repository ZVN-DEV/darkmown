const copyBtn = document.querySelector("[data-copy-cmd]");

if (copyBtn) {
  copyBtn.addEventListener("click", async () => {
    const cmd = copyBtn.previousElementSibling?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(cmd);
      copyBtn.textContent = "Copied";
      copyBtn.classList.add("is-copied");
      setTimeout(() => {
        copyBtn.textContent = "Copy";
        copyBtn.classList.remove("is-copied");
      }, 1600);
    } catch {
      copyBtn.textContent = "Select + ⌘C";
    }
  });
}

const button = document.querySelector("[data-wd-demo]");

if (button) {
  button.addEventListener("click", () => {
    button.classList.toggle("is-on");
    button.textContent = button.classList.contains("is-on")
      ? "Colocated index.js is active"
      : "Script is waiting";
  });
}
