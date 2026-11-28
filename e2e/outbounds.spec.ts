import { expect, test } from "@playwright/test";

test("outbound inventory filters, follows nested selections and observes streamed test history", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page.getByText("Mock mode", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Outbounds", exact: true }).first().click();
  await expect(page).toHaveURL(/#\/proxies$/);
  await expect(page.getByRole("heading", { name: "Outbounds", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Expand Primary route", exact: true }).click();
  await page.getByRole("button", { name: "Select Auto route", exact: true }).click();
  await expect(page.getByRole("button", { name: "Selected: Auto route", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "All outbounds", exact: true }).click();

  const list = page.getByRole("list", { name: "All outbounds" });
  const independent = list.getByRole("listitem").filter({ hasText: "Independent direct" });
  await expect(independent).toContainText("No result");
  await expect(list.getByRole("listitem").filter({ has: page.getByText("Auto route", { exact: true }) })).toContainText("Selected");
  await list.getByRole("button", { name: "Group details for Primary route", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Primary route" });
  await expect(details).toContainText("Primary route → Auto route → Singapore 01");
  await details.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("combobox", { name: "Sort outbounds", exact: true }).click();
  await page.getByRole("option", { name: "Lowest latency", exact: true }).click();
  await expect(list.getByRole("listitem").first()).toContainText("Tokyo 01");
  await page.getByRole("radio", { name: "Compact cards", exact: true }).click();
  await expect(list).toHaveClass(/proxy-cards/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.getByRole("combobox", { name: "Protocol filter", exact: true }).click();
  await page.getByRole("option", { name: "direct", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  const search = page.getByRole("textbox", { name: "Search outbounds", exact: true });
  await search.fill("independent");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await independent.getByRole("button", { name: "Test Independent direct", exact: true }).click();
  await expect(independent.locator("time")).toHaveAttribute("datetime", /T/);
  await expect(page.getByRole("status").filter({ hasText: "Fresh latency observed for Independent direct." })).toBeVisible();

  await search.clear();
  await page.getByRole("button", { name: "Test matching nodes (2)", exact: true }).click();
  const direct = list.getByRole("listitem").filter({ has: page.getByText("Direct", { exact: true }) });
  await expect(direct.locator("time")).toHaveAttribute("datetime", /T/);
  expect(errors).toEqual([]);
});

test("expanded outbound group pages all members and preserves keyboard access", async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 320, height: 740 });
  await page.route((url) => url.pathname === "/src/mocks/client.ts", async (route) => {
    const source = await (await route.fetch()).text();
    const anchor = "const groupsByTag = new Map(";
    expect(source.split(anchor)).toHaveLength(2);
    await route.fulfill({
      contentType: "application/javascript",
      body: source.replace(anchor, `
        const largeGroup = groups.find(({ tag }) => tag === "Primary route");
        const largeMembers = Array.from({ length: 121 }, (_, index) => create(GroupItemSchema, {
          tag: "Capacity member " + String(index + 1).padStart(3, "0"),
          type: index === 120 ? "wireguard" : "direct",
        }));
        largeGroup.items = largeMembers;
        largeGroup.selected = largeMembers[0].tag;
        window.addEventListener("test-group-member-count", ({ detail: count }) => {
          largeGroup.items = largeMembers.slice(0, count);
          if (!largeGroup.items.some(({ tag }) => tag === largeGroup.selected)) largeGroup.selected = largeMembers[0].tag;
          revision++;
        });
        ${anchor}`),
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await page.getByRole("link", { name: "Outbounds", exact: true }).first().click();

  const disclosure = page.getByRole("button", { name: /^(Expand|Collapse) Primary route$/ });
  const group = page.locator(".proxy-group-card").filter({ has: disclosure });
  const pager = group.getByRole("group", { name: "Member pages for Primary route", exact: true });
  const previous = pager.getByRole("button", { name: "Previous page", exact: true });
  const next = pager.getByRole("button", { name: "Next page", exact: true });
  const rows = group.locator(".proxy-row");
  const member = (number: number) => `Capacity member ${String(number).padStart(3, "0")}`;
  const lastMember = rows.getByText(member(121), { exact: true });
  const expectPage = async (current: number, count: number, first: number) => {
    await expect(pager.getByRole("status")).toHaveText(`Page ${current} / 3`);
    await expect(rows).toHaveCount(count);
    await expect(rows.first().getByText(member(first), { exact: true })).toBeVisible();
  };

  await expect(rows).toHaveCount(0);
  await expect(pager).toHaveCount(0);
  await disclosure.press("Enter");
  await expectPage(1, 60, 1);
  await expect(previous).toBeDisabled();
  await previous.press("Enter");
  await expectPage(1, 60, 1);

  await next.focus();
  await page.keyboard.press("Enter");
  await expectPage(2, 60, 61);
  await expect(next).toBeFocused();
  await page.keyboard.press("Enter");
  await expectPage(3, 1, 121);
  await expect(next).toBeFocused();
  await expect(next).toBeDisabled();
  await page.keyboard.press("Enter");
  await expectPage(3, 1, 121);
  expect(await pager.evaluate((node) => {
    const controls = Array.from(node.querySelectorAll("button"));
    return document.documentElement.scrollWidth <= innerWidth && controls.every((control) => {
      const { left, right } = control.getBoundingClientRect();
      return left >= 0 && right <= innerWidth;
    });
  })).toBe(true);

  await rows.getByRole("button", { name: `Select ${member(121)}`, exact: true }).press("Enter");
  await expect(rows.getByRole("button", { name: `Selected: ${member(121)}`, exact: true })).toBeVisible();
  await expect(disclosure).toHaveAccessibleDescription(`Selected: ${member(121)}`);
  await expectPage(3, 1, 121);
  await previous.press("Enter");
  await expectPage(2, 60, 61);
  await expect(lastMember).toHaveCount(0);

  const protocol = page.getByRole("combobox", { name: "Protocol filter", exact: true });
  await protocol.click();
  await page.getByRole("option", { name: "wireguard", exact: true }).click();
  await expect(lastMember).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(pager).toHaveCount(0);
  await protocol.click();
  await page.getByRole("option", { name: "All protocols", exact: true }).click();
  await expectPage(1, 60, 1);

  const search = page.getByRole("textbox", { name: "Search outbounds", exact: true });
  await search.fill(member(121));
  await expect(lastMember).toBeVisible();
  await expect(rows).toHaveCount(1);
  await search.clear();
  await expectPage(1, 60, 1);

  await next.press("Enter");
  await next.press("Enter");
  await expectPage(3, 1, 121);
  const resizeGroup = (count: number) => page.evaluate((detail) => {
    window.dispatchEvent(new CustomEvent("test-group-member-count", { detail }));
  }, count);
  await resizeGroup(45);
  await expect(pager).toHaveCount(0);
  await expect(rows).toHaveCount(45);
  await expect(disclosure).toBeFocused();
  await resizeGroup(121);
  await expectPage(1, 60, 1);
  expect(errors).toEqual([]);
});
