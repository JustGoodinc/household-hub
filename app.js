(() => {
  "use strict";

  const CATEGORY_INFO = {
    food: { label: "Food", icon: "🍎" },
    gas: { label: "Gas", icon: "⛽" },
    utilities: { label: "Utilities", icon: "💡" },
    house_bills: { label: "House Bills", icon: "🏠" },
    entertainment: { label: "Entertainment", icon: "🎬" }
  };
  const DAY_NAMES = ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Day 6", "Day 7"];
  const PURCHASE_SUMMARY_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const PURCHASE_SUMMARY_RETRY_MS = 5 * 60 * 1000;
  const TUTORIAL_TOTAL_STEPS = 9;
  const DEFAULT_THEME = "forest";
  const THEMES = Object.freeze({
    forest: { name: "Forest", primary: "#344D36", accent: "#F7B37A" },
    berry: { name: "Berry", primary: "#BE5870", accent: "#B583E6" },
    sunset: { name: "Sunset", primary: "#FF8000", accent: "#F2B6EA" },
    mint: { name: "Mint", primary: "#A9D3B8", accent: "#BDAF20" },
    sky_night: { name: "Sky Night", primary: "#A9C5EA", accent: "#6A004E" },
    desert: { name: "Desert", primary: "#D9CB69", accent: "#BF4E3A" },
    ocean: { name: "Ocean", primary: "#629BE5", accent: "#245D38" },
    lemon: { name: "Lemon", primary: "#FFD500", accent: "#E796E3" },
    lavender: { name: "Lavender", primary: "#AAA5D6", accent: "#13777A" }
  });

  const state = {
    client: null,
    session: null,
    user: null,
    membership: null,
    household: null,
    members: [],
    purchases: [],
    recipes: [],
    groceryItems: [],
    groceryBudget: null,
    plan: [],
    currentPlan: [],
    currentWeekStart: getMondayISO(new Date()),
    selectedWeekStart: getMondayISO(new Date()),
    themeSaving: false,
    purchaseSummaryChecking: false,
    productionWritesPending: 0,
    initializedSessionId: null
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  let purchaseSummaryTimer = null;
  let tutorialState = createEmptyTutorialState();
  let tutorialTargetElement = null;
  let tutorialPositionFrame = null;

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    applyTheme(DEFAULT_THEME);
    bindEvents();
    setupAutoHideNavigation();
    setDefaultDates();

    const config = /** @type {{ SUPABASE_URL?: string, SUPABASE_ANON_KEY?: string }} */ (window.APP_CONFIG || {});
    const configured =
      config.SUPABASE_URL &&
      config.SUPABASE_ANON_KEY &&
      !config.SUPABASE_URL.includes("PASTE_") &&
      !config.SUPABASE_ANON_KEY.includes("PASTE_");

    if (!configured || !window.supabase?.createClient) {
      showOnly("setup-screen");
      return;
    }

    state.client = window.supabase.createClient(
      config.SUPABASE_URL.trim(),
      config.SUPABASE_ANON_KEY.trim(),
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );

    state.client.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => handleSession(session), 0);
    });

    const { data, error } = await state.client.auth.getSession();
    if (error) {
      showToast(error.message, true);
      showOnly("auth-screen");
      return;
    }
    await handleSession(data.session);
  }

  function bindEvents() {
    $("#show-signin").addEventListener("click", () => switchAuthMode("signin"));
    $("#show-signup").addEventListener("click", () => switchAuthMode("signup"));
    $("#signin-form").addEventListener("submit", signIn);
    $("#signup-form").addEventListener("submit", signUp);
    $("#create-household-form").addEventListener("submit", createHousehold);
    $("#join-household-form").addEventListener("submit", joinHousehold);
    $("#onboarding-logout").addEventListener("click", signOut);
    $("#app-logout").addEventListener("click", signOut);

    $$(".nav-button, .nav-link").forEach((button) => {
      button.addEventListener("click", () => {
        if (isTutorialMode() && tutorialStepDefinition(tutorialState.step)?.page !== button.dataset.target) {
          showToast("Follow the highlighted practice step, or exit the tutorial first.");
          showTutorialStep(tutorialState.step);
          return;
        }
        navigate(button.dataset.target);
      });
    });
    $("#topbar-add").addEventListener("click", () => {
      if (isTutorialMode() && tutorialStepDefinition(tutorialState.step)?.page !== "purchases") {
        showToast("Follow the highlighted practice step, or exit the tutorial first.");
        showTutorialStep(tutorialState.step);
        return;
      }
      navigate("purchases");
      window.setTimeout(() => $("#purchase-amount").focus(), 80);
    });
    $("#topbar-refresh").addEventListener("click", refreshHouseholdHub);

    $("#purchase-form").addEventListener("submit", savePurchase);
    $("#purchase-cancel-edit").addEventListener("click", resetPurchaseForm);
    $("#purchase-month-filter").addEventListener("change", renderPurchaseHistory);
    $("#purchase-category-filter").addEventListener("change", renderPurchaseHistory);
    $("#purchase-history").addEventListener("click", handlePurchaseAction);

    $("#recipe-form").addEventListener("submit", saveRecipe);
    $("#recipe-cancel-edit").addEventListener("click", resetRecipeForm);
    $("#bulk-import-button").addEventListener("click", bulkImportRecipes);
    $("#recipe-search").addEventListener("input", renderRecipes);
    $("#recipe-list").addEventListener("click", handleRecipeAction);
    $("#planner-recipe-toggles").addEventListener("click", handleRecipeAction);

    $("#generate-meals").addEventListener("click", generateMealPlan);
    $("#previous-week").addEventListener("click", () => changeWeek(-7));
    $("#next-week").addEventListener("click", () => changeWeek(7));
    $("#meal-plan-list").addEventListener("click", handleMealAction);
    $("#meal-plan-list").addEventListener("change", handleMealSelection);

    $("#grocery-form").addEventListener("submit", saveGroceryItem);
    $("#grocery-list").addEventListener("click", handleGroceryAction);
    $("#grocery-filter").addEventListener("change", renderGroceryList);
    $("#grocery-budget").addEventListener("change", saveGroceryBudget);
    $("#add-plan-ingredients").addEventListener("click", addPlanIngredientsToGrocery);
    $("#clear-collected").addEventListener("click", clearCollectedGroceryItems);

    $("#copy-invite-code").addEventListener("click", copyInviteCode);
    $("#theme-picker").addEventListener("click", saveHouseholdTheme);
    $("#purchase-summaries-enabled").addEventListener("change", updatePurchaseSummaryPreference);
    $("#purchase-summary-close").addEventListener("click", closePurchaseSummary);
    $("#purchase-summary-view").addEventListener("click", viewPurchaseSummaryPurchases);
    $("#purchase-summary-dialog").addEventListener("cancel", (event) => {
      event.preventDefault();
      closePurchaseSummary();
    });
    $("#purchase-summary-dialog").addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closePurchaseSummary();
    });

    $("#tutorial-start-button").addEventListener("click", startTutorialFromSettings);
    $("#tutorial-welcome-start").addEventListener("click", startTutorialFromWelcome);
    $("#tutorial-welcome-later").addEventListener("click", dismissTutorialWelcome);
    $("#tutorial-welcome-dialog").addEventListener("cancel", (event) => event.preventDefault());
    $("#tutorial-exit-button").addEventListener("click", requestTutorialExit);
    $("#tutorial-skip-button").addEventListener("click", requestTutorialExit);
    $("#tutorial-back-button").addEventListener("click", tutorialBack);
    $("#tutorial-primary-button").addEventListener("click", handleTutorialPrimaryAction);
    $("#tutorial-restart-button").addEventListener("click", restartTutorial);
    $("#tutorial-price-form").addEventListener("submit", completeTutorialGroceryCollection);
    $("#tutorial-price-cancel").addEventListener("click", closeTutorialPriceDialog);
    $("#tutorial-price-dialog").addEventListener("cancel", (event) => {
      event.preventDefault();
      closeTutorialPriceDialog();
    });
    $("#tutorial-keep-learning").addEventListener("click", keepLearning);
    $("#tutorial-confirm-exit").addEventListener("click", confirmTutorialExit);
    $("#tutorial-exit-dialog").addEventListener("cancel", (event) => {
      event.preventDefault();
      keepLearning();
    });
    window.addEventListener("resize", scheduleTutorialPosition);
    window.addEventListener("scroll", scheduleTutorialPosition, { passive: true });
    window.visualViewport?.addEventListener("resize", scheduleTutorialPosition);
    window.visualViewport?.addEventListener("scroll", scheduleTutorialPosition);
  }

  async function handleSession(session) {
    const sessionId = session?.access_token || null;
    if (sessionId && state.initializedSessionId === sessionId) return;

    if (state.initializedSessionId !== sessionId) {
      clearPurchaseSummaryTimer();
      closePurchaseSummary();
      discardTutorialSession(false);
    }

    state.session = session;
    state.user = session?.user || null;

    if (!session) {
      clearState();
      state.initializedSessionId = null;
      showOnly("auth-screen");
      return;
    }

    state.initializedSessionId = sessionId;
    await loadMembership();
  }

  function clearState() {
    clearPurchaseSummaryTimer();
    closePurchaseSummary();
    discardTutorialSession(false);
    state.membership = null;
    state.household = null;
    state.members = [];
    state.purchases = [];
    state.recipes = [];
    state.groceryItems = [];
    state.groceryBudget = null;
    state.plan = [];
    state.currentPlan = [];
    state.themeSaving = false;
    state.purchaseSummaryChecking = false;
    state.productionWritesPending = 0;
    applyTheme(DEFAULT_THEME);
  }

  async function loadMembership() {
    const { data, error } = await state.client
      .from("household_members")
      .select("household_id, display_name, role, purchase_summaries_enabled, purchase_summary_last_checked_at, tutorial_prompt_seen, tutorial_completed, tutorial_completed_at, households(id, name, invite_code, theme)")
      .eq("user_id", state.user.id)
      .maybeSingle();

    if (error) {
      showToast(`Database setup error: ${error.message}`, true);
      showOnly("onboarding-screen");
      return;
    }

    if (!data) {
      const savedName = state.user.user_metadata?.display_name || "";
      $("#creator-display-name").value = savedName;
      $("#join-display-name").value = savedName;
      showOnly("onboarding-screen");
      return;
    }

    state.membership = data;
    state.household = Array.isArray(data.households) ? data.households[0] : data.households;
    state.household.theme = normalizeTheme(state.household.theme);
    applyTheme(state.household.theme);
    state.selectedWeekStart = state.currentWeekStart;
    try {
      await loadAllData();
      showOnly("app-shell");
      navigate("dashboard");
      const prompted = await maybeShowTutorialPrompt();
      if (!prompted) await checkPurchaseSummary();
    } catch (error) {
      showToast(error.message || "Unable to load household data.", true);
    }
  }

  async function loadAllData() {
    await Promise.all([loadMembers(), loadPurchases(), loadRecipes(), loadGroceryItems(), loadGroceryBudget()]);
    await loadPlan(state.currentWeekStart);
    renderAll();
  }

  async function loadMembers() {
    const { data, error } = await state.client
      .from("household_members")
      .select("user_id, display_name, role, created_at")
      .eq("household_id", state.household.id)
      .order("created_at", { ascending: true });
    if (error) throwAndToast(error);
    state.members = data || [];
  }

  async function loadPurchases() {
    const { data, error } = await state.client
      .from("purchases")
      .select("*")
      .eq("household_id", state.household.id)
      .order("purchase_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throwAndToast(error);
    state.purchases = data || [];
  }

  async function loadRecipes() {
    const { data, error } = await state.client
      .from("recipes")
      .select("*")
      .eq("household_id", state.household.id)
      .order("name", { ascending: true });
    if (error) throwAndToast(error);
    state.recipes = data || [];
  }

  async function loadGroceryItems() {
    const { data, error } = await state.client
      .from("grocery_items")
      .select("*")
      .eq("household_id", state.household.id)
      .order("is_collected", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throwAndToast(error);
    state.groceryItems = data || [];
  }

  async function loadGroceryBudget() {
    const { data, error } = await state.client
      .from("grocery_budgets")
      .select("amount")
      .eq("household_id", state.household.id)
      .maybeSingle();
    if (error) throwAndToast(error);
    state.groceryBudget = data?.amount == null ? null : Number(data.amount);
  }

  async function loadPlan(weekStart) {
    const { data, error } = await state.client
      .from("meal_plans")
      .select("id, day_index, plan_type, assigned_cook, recipe_id, recipes(name, can_cook)")
      .eq("household_id", state.household.id)
      .eq("week_start", weekStart)
      .order("day_index", { ascending: true });
    if (error) throwAndToast(error);

    state.plan = (data || []).map((item) => ({
      ...item,
      plan_type: item.plan_type || "recipe",
      recipe: Array.isArray(item.recipes) ? item.recipes[0] : item.recipes
    }));
    if (weekStart === state.currentWeekStart) state.currentPlan = [...state.plan];
    renderMealPlan();
    renderDashboardMeals();
  }

  function renderAll() {
    $("#topbar-household").textContent = state.household.name;
    $("#welcome-name").textContent = state.membership.display_name;
    renderDashboardDate();
    $("#current-month-label").textContent = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date());
    $("#settings-household-name").textContent = state.household.name;
    $("#settings-invite-code").textContent = state.household.invite_code;
    $("#purchase-month-filter").value = currentMonthValue();
    fillMemberSelect();
    renderDashboard();
    renderPurchaseHistory();
    renderRecipes();
    renderPlannerRecipeToggles();
    renderMealPlan();
    renderGroceryList();
    renderGrocerySummary();
    renderMembers();
    renderThemePicker();
    renderPurchaseSummaryPreference();
    renderTutorialHelp();
  }

  function displayedPurchases() {
    return isTutorialMode() ? tutorialState.purchases : state.purchases;
  }

  function displayedRecipes() {
    return isTutorialMode() ? tutorialState.recipes : state.recipes;
  }

  function displayedGroceryItems() {
    return isTutorialMode() ? tutorialState.groceryItems : state.groceryItems;
  }

  function displayedGroceryBudget() {
    return isTutorialMode() ? tutorialState.groceryBudget : state.groceryBudget;
  }

  function renderDashboard() {
    renderDashboardDate();
    const month = currentMonthValue();
    const purchases = displayedPurchases();
    const monthly = purchases.filter((purchase) => purchase.purchase_date.startsWith(month));
    const grouped = { food: [], gas: [], utilities: [], house_bills: [], entertainment: [] };
    monthly.forEach((purchase) => grouped[purchase.category]?.push(Number(purchase.amount)));

    for (const category of Object.keys(grouped)) {
      const values = grouped[category];
      const total = sum(values);
      const average = values.length ? total / values.length : 0;
      $("#dash-" + category + "-total").textContent = formatCurrency(total);
      $("#dash-" + category + "-average").textContent = `Avg. ${formatCurrency(average)}`;
    }

    $("#dash-month-total").textContent = formatCurrency(sum(monthly.map((p) => Number(p.amount))));
    $("#dash-purchase-count").textContent = `${monthly.length} purchase${monthly.length === 1 ? "" : "s"}`;

    const recent = purchases.slice(0, 5);
    const container = $("#recent-purchases");
    if (!recent.length) {
      container.className = "purchase-list empty-state";
      container.textContent = "No purchases yet.";
    } else {
      container.className = "purchase-list";
      container.innerHTML = recent.map((purchase) => purchaseMarkup(purchase, false)).join("");
    }
    renderDashboardMeals();
  }

  function renderDashboardMeals() {
    const container = $("#dashboard-meals");
    if (isTutorialMode()) {
      container.className = "mini-meal-list empty-state";
      container.textContent = "Your real meal plan stays safely outside Practice Mode.";
      return;
    }
    if (!state.currentPlan.length) {
      container.className = "mini-meal-list empty-state";
      container.textContent = "No meal plan yet.";
      return;
    }
    container.className = "mini-meal-list";
    container.innerHTML = DAY_NAMES.map((dayName, dayIndex) => {
      const item = state.currentPlan.find((entry) => entry.day_index === dayIndex);
      return `
        <div class="mini-meal${item?.plan_type === "eat_out" ? " is-eat-out" : ""}">
          <span>${dayName}</span>
          <strong>${item?.plan_type === "eat_out" ? '<span aria-hidden="true">🍽️</span> ' : ""}${escapeHTML(mealPlanName(item))}</strong>
          <span>${escapeHTML(mealPlanStatus(item))}</span>
        </div>
      `;
    }).join("");
  }

  function fillMemberSelect() {
    const select = $("#purchase-person");
    select.innerHTML = state.members
      .map((member) => `<option value="${escapeAttribute(member.display_name)}">${escapeHTML(member.display_name)}</option>`)
      .join("");
    select.value = state.membership.display_name;
  }

  function renderPurchaseHistory() {
    if (!state.household) return;
    const month = $("#purchase-month-filter").value || currentMonthValue();
    const category = $("#purchase-category-filter").value;
    const filtered = displayedPurchases().filter((purchase) => {
      const monthMatches = purchase.purchase_date.startsWith(month);
      const categoryMatches = category === "all" || purchase.category === category;
      return monthMatches && categoryMatches;
    });

    const values = filtered.map((purchase) => Number(purchase.amount));
    $("#purchase-filter-summary").innerHTML = `
      <span>Total: ${formatCurrency(sum(values))}</span>
      <span>Average: ${formatCurrency(values.length ? sum(values) / values.length : 0)}</span>
      <span>${filtered.length} entr${filtered.length === 1 ? "y" : "ies"}</span>
    `;

    const container = $("#purchase-history");
    if (!filtered.length) {
      container.className = "purchase-list empty-state";
      container.textContent = "No purchases found.";
      return;
    }
    container.className = "purchase-list";
    container.innerHTML = filtered.map((purchase) => purchaseMarkup(purchase, true)).join("");
  }

  function purchaseMarkup(purchase, showActions) {
    const info = CATEGORY_INFO[purchase.category] || { label: purchase.category, icon: "•" };
    const title = purchase.store?.trim() || info.label;
    return `
      <article class="purchase-item">
        <span class="category-dot ${escapeAttribute(purchase.category)}">${info.icon}</span>
        <div class="purchase-main">
          <h3>${escapeHTML(title)}</h3>
          <p>${info.label} · ${formatDisplayDate(purchase.purchase_date)} · ${escapeHTML(purchase.purchased_by)}</p>
        </div>
        <div class="purchase-side">
          <strong>${formatCurrency(Number(purchase.amount))}</strong>
          ${showActions && !isTutorialMode() ? `<div class="item-actions">
            <button class="mini-action" type="button" data-action="edit-purchase" data-id="${purchase.id}">Edit</button>
            <button class="mini-action delete" type="button" data-action="delete-purchase" data-id="${purchase.id}">Delete</button>
          </div>` : ""}
        </div>
      </article>
    `;
  }

  function renderRecipes() {
    if (!state.household) return;
    const query = $("#recipe-search").value.trim().toLowerCase();
    const allRecipes = displayedRecipes();
    const recipes = allRecipes.filter((recipe) => recipe.name.toLowerCase().includes(query));
    const enabledCount = allRecipes.filter(isRecipeEnabled).length;
    $("#recipe-count").textContent = allRecipes.length;
    $("#recipe-enabled-count").textContent = `${enabledCount} enabled for random plans`;
    const container = $("#recipe-list");

    if (!recipes.length) {
      container.className = "recipe-grid empty-state";
      container.textContent = allRecipes.length ? "No recipes match your search." : "No recipes yet.";
      return;
    }

    container.className = "recipe-grid";
    container.innerHTML = recipes.map((recipe) => {
      const enabled = isRecipeEnabled(recipe);
      const details = [
        recipe.ingredients?.trim() ? `<strong>Ingredients</strong>
${escapeHTML(recipe.ingredients.trim())}` : "",
        recipe.instructions?.trim() ? `<strong>Instructions</strong>
${escapeHTML(recipe.instructions.trim())}` : ""
      ].filter(Boolean).join("\n\n");
      return `
        <article class="recipe-card${enabled ? "" : " is-disabled"}"${isTutorialMode() ? ' data-tutorial-target="taco-recipe-card"' : ""}>
          <div class="recipe-card-top">
            <div class="recipe-title-wrap">
              <h3>${escapeHTML(recipe.name)}</h3>
              <div class="cook-tags">${(recipe.can_cook || []).map((name) => `<span class="cook-tag">${escapeHTML(name)}</span>`).join("")}</div>
            </div>
            <div class="item-actions${isTutorialMode() ? " hidden" : ""}">
              <button class="mini-action" type="button" data-action="edit-recipe" data-id="${recipe.id}">Edit</button>
              <button class="mini-action delete" type="button" data-action="delete-recipe" data-id="${recipe.id}">Delete</button>
            </div>
          </div>
          <div class="recipe-card-footer">
            <button class="meal-toggle-button${enabled ? " is-on" : " is-off"}" type="button" role="switch" aria-checked="${enabled}" data-action="toggle-recipe" data-id="${recipe.id}"${isTutorialMode() ? ' data-tutorial-target="recipe-toggle"' : ""}>
              <span class="toggle-indicator" aria-hidden="true"></span>
              <span>${enabled ? "Included in random plans" : "Skipped in random plans"}</span>
            </button>
            ${isTutorialMode() ? `<button class="secondary-button tutorial-ingredient-button" type="button" data-action="tutorial-add-recipe-ingredients" data-id="${recipe.id}" data-tutorial-target="recipe-ingredients-import">Add Ingredients to Grocery List</button>` : ""}
          </div>
          ${details ? `<details class="recipe-details"><summary>View recipe details</summary><pre>${details}</pre></details>` : ""}
        </article>
      `;
    }).join("");
  }

  function renderPlannerRecipeToggles() {
    if (!state.household) return;
    const container = $("#planner-recipe-toggles");
    const recipes = displayedRecipes();
    const enabledCount = recipes.filter(isRecipeEnabled).length;
    $("#planner-enabled-count").textContent = `${enabledCount} of ${recipes.length} enabled`;

    if (!recipes.length) {
      container.className = "meal-pool-list empty-state";
      container.textContent = "Add recipes first, then choose which meals can be randomized.";
      return;
    }

    container.className = "meal-pool-list";
    container.innerHTML = recipes.map((recipe) => {
      const enabled = isRecipeEnabled(recipe);
      const cooks = (recipe.can_cook || []).join(" or ") || "No cook assigned";
      return `
        <article class="meal-pool-item${enabled ? "" : " is-disabled"}">
          <div class="meal-pool-copy">
            <h3>${escapeHTML(recipe.name)}</h3>
            <p>${escapeHTML(cooks)}</p>
          </div>
          <button class="meal-toggle-button compact${enabled ? " is-on" : " is-off"}" type="button" role="switch" aria-checked="${enabled}" data-action="toggle-recipe" data-id="${recipe.id}">
            <span class="toggle-indicator" aria-hidden="true"></span>
            <span>${enabled ? "On" : "Off"}</span>
          </button>
        </article>
      `;
    }).join("");
  }

  function renderMealPlan() {
    if (!state.household) return;
    $("#planner-week-label").textContent = formatWeekRange(state.selectedWeekStart);
    const container = $("#meal-plan-list");
    const enabledCount = displayedRecipes().filter(isRecipeEnabled).length;
    const guidance = !state.plan.length
      ? `<p class="meal-plan-guidance">${enabledCount < DAY_NAMES.length
        ? `Enable ${DAY_NAMES.length - enabledCount} more meal${DAY_NAMES.length - enabledCount === 1 ? "" : "s"} to randomize seven different meals, or choose any day manually.`
        : "No meals saved for this week. Press Randomize 7 meals or choose each day manually."}</p>`
      : "";
    container.className = "meal-plan-list";
    container.innerHTML = guidance + DAY_NAMES.map((dayName, dayIndex) => {
      const item = state.plan.find((entry) => entry.day_index === dayIndex);
      const selectedValue = item?.plan_type === "eat_out" ? "eat_out" : item?.recipe_id || "";
      return `
        <article class="meal-card${item?.plan_type === "eat_out" ? " is-eat-out" : ""}">
          <span class="day-badge">${dayName}</span>
          <div class="meal-card-main">
            <h3>${item?.plan_type === "eat_out" ? '<span aria-hidden="true">🍽️</span> ' : ""}${escapeHTML(mealPlanName(item))}</h3>
            <p>${escapeHTML(mealPlanStatus(item))}</p>
          </div>
          <label class="meal-select-wrap">
            <span class="sr-only">Choose meal for ${dayName}</span>
            <select class="meal-selector" data-action="select-meal" data-day="${dayIndex}" data-previous-value="${escapeAttribute(selectedValue)}" aria-label="Choose meal for ${dayName}">
              ${mealSelectorOptions(selectedValue)}
            </select>
          </label>
          <button class="reroll-button" type="button" title="Reroll ${dayName}" aria-label="Reroll ${dayName}" data-action="reroll-meal" data-day="${dayIndex}">↻</button>
        </article>
      `;
    }).join("");
  }

  function mealSelectorOptions(selectedValue) {
    const placeholder = `<option value=""${selectedValue ? "" : " selected"} disabled>Choose a meal</option>`;
    const eatingOut = `<option value="eat_out"${selectedValue === "eat_out" ? " selected" : ""}>Eating Out</option>`;
    const recipes = displayedRecipes().map((recipe) => `
      <option value="${escapeAttribute(recipe.id)}"${selectedValue === recipe.id ? " selected" : ""}>${escapeHTML(recipe.name)}</option>
    `).join("");
    return placeholder + eatingOut + recipes;
  }

  function mealPlanName(item) {
    if (!item) return "Not planned";
    if (item.plan_type === "eat_out") return "Eating Out";
    return item.recipe?.name || "Deleted recipe";
  }

  function mealPlanStatus(item) {
    if (!item) return "Choose a meal";
    if (item.plan_type === "eat_out") return "No cooking";
    return `${item.assigned_cook} cooks`;
  }

  function renderMembers() {
    const container = $("#member-list");
    container.innerHTML = state.members.map((member) => `
      <div class="member-item">
        <span class="avatar">${escapeHTML(member.display_name.slice(0, 1).toUpperCase())}</span>
        <div>
          <p><strong>${escapeHTML(member.display_name)}</strong></p>
          <small>${member.role === "owner" ? "Household owner" : "Household member"}</small>
        </div>
      </div>
    `).join("");
  }

  function renderDashboardDate() {
    const dateElement = $("#dashboard-current-date");
    if (!dateElement) return;
    dateElement.textContent = new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    }).format(new Date());
  }

  function normalizeTheme(themeValue) {
    return Object.prototype.hasOwnProperty.call(THEMES, themeValue) ? themeValue : DEFAULT_THEME;
  }

  function isHouseholdOwner() {
    return state.membership?.role === "owner";
  }

  function renderThemePicker() {
    const picker = $("#theme-picker");
    if (!picker || !state.household) return;
    const selectedTheme = normalizeTheme(state.household.theme);
    const ownerCanEdit = isHouseholdOwner();
    picker.setAttribute("aria-busy", String(state.themeSaving));
    picker.querySelectorAll("button[data-theme]").forEach((button) => {
      const selected = button.dataset.theme === selectedTheme;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-checked", String(selected));
      button.disabled = state.themeSaving || !ownerCanEdit;
      button.setAttribute("aria-disabled", String(!ownerCanEdit));
      const indicator = button.querySelector(".theme-selected-indicator");
      if (indicator) indicator.textContent = selected ? "✓ Selected" : "Select";
    });
    $("#theme-owner-note").classList.toggle("hidden", ownerCanEdit);
  }

  async function saveHouseholdTheme(event) {
    const button = event.target.closest("button[data-theme]");
    if (!button || state.themeSaving || !isHouseholdOwner()) return;
    if (blockTutorialProductionWrite("household theme update")) return;

    const nextTheme = normalizeTheme(button.dataset.theme);
    const previousTheme = normalizeTheme(state.household.theme);
    if (nextTheme === previousTheme) return;

    state.themeSaving = true;
    state.household.theme = nextTheme;
    applyTheme(nextTheme);
    renderThemePicker();

    const { data, error } = await runProductionMutation(
      "household theme update",
      () => state.client.rpc("update_household_theme", { p_theme: nextTheme })
    );
    state.themeSaving = false;

    if (error) {
      state.household.theme = previousTheme;
      applyTheme(previousTheme);
      renderThemePicker();
      showToast(`Theme could not be saved: ${error.message}`, true);
      return;
    }

    const savedTheme = normalizeTheme(typeof data === "string" ? data : data?.theme || nextTheme);
    state.household.theme = savedTheme;
    applyTheme(savedTheme);
    renderThemePicker();
    showToast(`${THEMES[savedTheme].name} theme saved.`);
  }

  function applyTheme(themeValue) {
    const selectedTheme = normalizeTheme(themeValue);
    const theme = THEMES[selectedTheme];
    const variables = {
      "--primary": theme.primary,
      "--primary-hover": mixHex(theme.primary, "#000000", 0.12),
      "--primary-contrast": readableTextColor(theme.primary),
      "--primary-ink": accessibleInk(theme.primary, "#FFFFFF"),
      "--accent": theme.accent,
      "--accent-hover": mixHex(theme.accent, "#000000", 0.12),
      "--accent-contrast": readableTextColor(theme.accent),
      "--background": "#F7F4EE",
      "--surface": "#FFFDF8",
      "--card": "#FFFFFF",
      "--border": "#DED8CA",
      "--text": "#2F312D",
      "--muted-text": "#6F726B",
      "--success": "#2F6B47",
      "--warning": "#8A5A13",
      "--danger": "#A7443D",
      "--shadow-color": "rgba(42, 45, 40, 0.14)",
      "--primary-soft": colorWithAlpha(theme.primary, 0.14),
      "--accent-soft": colorWithAlpha(theme.accent, 0.18),
      "--focus-ring": colorWithAlpha(accessibleInk(theme.primary, "#FFFFFF"), 0.4),
      "--surface-translucent": "rgba(255, 253, 248, 0.94)"
    };

    Object.entries(variables).forEach(([property, value]) => {
      document.documentElement.style.setProperty(property, value);
    });
    document.documentElement.dataset.theme = selectedTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.primary);
    return selectedTheme;
  }

  function readableTextColor(background) {
    const dark = "#1F2320";
    const light = "#FFFFFF";
    return contrastRatio(background, dark) >= contrastRatio(background, light) ? dark : light;
  }

  function accessibleInk(color, background) {
    let candidate = color;
    while (contrastRatio(candidate, background) < 4.5) {
      candidate = mixHex(candidate, "#000000", 0.08);
    }
    return candidate;
  }

  function contrastRatio(first, second) {
    const firstLuminance = relativeLuminance(first);
    const secondLuminance = relativeLuminance(second);
    const lighter = Math.max(firstLuminance, secondLuminance);
    const darker = Math.min(firstLuminance, secondLuminance);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function relativeLuminance(hexColor) {
    const channels = hexToRgb(hexColor).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return (channels[0] * 0.2126) + (channels[1] * 0.7152) + (channels[2] * 0.0722);
  }

  function mixHex(color, target, amount) {
    const sourceChannels = hexToRgb(color);
    const targetChannels = hexToRgb(target);
    return `#${sourceChannels.map((channel, index) => {
      const mixed = Math.round(channel + ((targetChannels[index] - channel) * amount));
      return mixed.toString(16).padStart(2, "0");
    }).join("")}`;
  }

  function colorWithAlpha(color, alpha) {
    const [red, green, blue] = hexToRgb(color);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  function hexToRgb(hexColor) {
    const normalized = hexColor.replace("#", "");
    return [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16));
  }

  function renderPurchaseSummaryPreference() {
    const control = $("#purchase-summaries-enabled");
    if (!control || !state.membership) return;
    control.checked = state.membership.purchase_summaries_enabled !== false;
  }

  function clearPurchaseSummaryTimer() {
    if (purchaseSummaryTimer !== null) {
      window.clearTimeout(purchaseSummaryTimer);
      purchaseSummaryTimer = null;
    }
  }

  function schedulePurchaseSummaryCheck(delayOverride = null) {
    clearPurchaseSummaryTimer();
    if (isTutorialMode() || !state.session || !state.household || state.membership?.purchase_summaries_enabled === false) return;

    let delay = delayOverride;
    if (delay === null) {
      const checkpointTime = Date.parse(state.membership?.purchase_summary_last_checked_at || "");
      delay = Number.isFinite(checkpointTime)
        ? Math.max(PURCHASE_SUMMARY_INTERVAL_MS - (Date.now() - checkpointTime), 0)
        : 0;
    }

    purchaseSummaryTimer = window.setTimeout(() => {
      purchaseSummaryTimer = null;
      void checkPurchaseSummary();
    }, Math.max(delay, 1000));
  }

  async function checkPurchaseSummary() {
    clearPurchaseSummaryTimer();
    if (
      state.purchaseSummaryChecking ||
      !state.session ||
      !state.household ||
      !state.membership ||
      isTutorialMode() ||
      state.membership.purchase_summaries_enabled === false
    ) return;

    state.purchaseSummaryChecking = true;
    const checkingUserId = state.user.id;
    try {
      const now = new Date();
      const nowISO = now.toISOString();
      const checkpoint = state.membership.purchase_summary_last_checked_at;
      const checkpointTime = Date.parse(checkpoint || "");

      if (!checkpoint || !Number.isFinite(checkpointTime)) {
        const savedCheckpoint = await savePurchaseSummaryCheckpoint(nowISO, checkingUserId);
        if (!savedCheckpoint) return;
        schedulePurchaseSummaryCheck();
        return;
      }

      if (now.getTime() - checkpointTime < PURCHASE_SUMMARY_INTERVAL_MS) {
        schedulePurchaseSummaryCheck();
        return;
      }

      const { data, error } = await state.client
        .from("purchases")
        .select("id, amount, category, store, purchased_by, created_by, created_at")
        .eq("household_id", state.household.id)
        .gt("created_at", checkpoint)
        .lte("created_at", nowISO)
        .order("created_at", { ascending: false });

      if (error) throw error;
      if (state.user?.id !== checkingUserId) return;

      const savedCheckpoint = await savePurchaseSummaryCheckpoint(nowISO, checkingUserId);
      if (!savedCheckpoint) return;
      const newPurchases = data || [];
      if (newPurchases.length) showPurchaseSummary(newPurchases);
      schedulePurchaseSummaryCheck();
    } catch (error) {
      showToast(`Purchase summary check failed: ${error.message || "Please try again."}`, true);
      schedulePurchaseSummaryCheck(PURCHASE_SUMMARY_RETRY_MS);
    } finally {
      state.purchaseSummaryChecking = false;
    }
  }

  async function savePurchaseSummaryCheckpoint(checkedAt, expectedUserId) {
    if (isTutorialMode() || state.user?.id !== expectedUserId) return null;
    const { data, error } = await runProductionMutation(
      "purchase summary checkpoint update",
      () => state.client.rpc("update_purchase_summary_checkpoint", { p_checked_at: checkedAt })
    );
    if (error) throw error;
    if (state.user?.id !== expectedUserId) return null;

    const savedCheckpoint = typeof data === "string" ? data : checkedAt;
    state.membership.purchase_summary_last_checked_at = savedCheckpoint;
    return savedCheckpoint;
  }

  async function updatePurchaseSummaryPreference(event) {
    const control = event.currentTarget;
    if (blockTutorialProductionWrite("purchase summary preference update")) {
      renderPurchaseSummaryPreference();
      return;
    }
    const preferenceUserId = state.user.id;
    const nextEnabled = control.checked;
    const previousEnabled = state.membership.purchase_summaries_enabled !== false;
    const previousCheckpoint = state.membership.purchase_summary_last_checked_at;

    control.disabled = true;
    state.membership.purchase_summaries_enabled = nextEnabled;
    if (!nextEnabled) {
      clearPurchaseSummaryTimer();
      closePurchaseSummary();
    }

    let data;
    let error;
    try {
      const result = await runProductionMutation(
        "purchase summary preference update",
        () => state.client.rpc("update_purchase_summary_preference", { p_enabled: nextEnabled })
      );
      data = result.data;
      error = result.error;
    } catch (requestError) {
      error = requestError;
    }
    control.disabled = false;

    if (state.user?.id !== preferenceUserId) return;

    if (error) {
      state.membership.purchase_summaries_enabled = previousEnabled;
      state.membership.purchase_summary_last_checked_at = previousCheckpoint;
      control.checked = previousEnabled;
      if (previousEnabled) schedulePurchaseSummaryCheck();
      showToast(`Purchase summary setting could not be saved: ${error.message}`, true);
      return;
    }

    const saved = Array.isArray(data) ? data[0] : data;
    state.membership.purchase_summaries_enabled = saved?.enabled ?? nextEnabled;
    state.membership.purchase_summary_last_checked_at = saved?.last_checked_at ?? (
      nextEnabled ? new Date().toISOString() : previousCheckpoint
    );
    control.checked = state.membership.purchase_summaries_enabled;

    if (state.membership.purchase_summaries_enabled) schedulePurchaseSummaryCheck();
    else clearPurchaseSummaryTimer();
    showToast(`Purchase summaries turned ${state.membership.purchase_summaries_enabled ? "on" : "off"}.`);
  }

  function showPurchaseSummary(purchases) {
    if (isTutorialMode() || !purchases.length || state.membership?.purchase_summaries_enabled === false) return;

    const breakdown = new Map();
    let total = 0;
    $("#purchase-summary-list").innerHTML = purchases.map((purchase) => {
      const info = CATEGORY_INFO[purchase.category] || { label: purchase.category, icon: "•" };
      const amount = Number(purchase.amount);
      const title = purchase.store?.trim() || info.label;
      total += amount;
      breakdown.set(purchase.category, (breakdown.get(purchase.category) || 0) + amount);
      return `
        <article class="purchase-summary-row">
          <span class="category-dot ${escapeAttribute(purchase.category)}" aria-hidden="true">${info.icon}</span>
          <div class="purchase-summary-copy">
            <strong>${escapeHTML(title)}</strong>
            <span>${escapeHTML(info.label)}</span>
            <small>Added by ${escapeHTML(purchaseAddedBy(purchase))}</small>
          </div>
          <strong class="purchase-summary-price">${formatCurrency(amount)}</strong>
        </article>
      `;
    }).join("");

    $("#purchase-summary-breakdown").innerHTML = Array.from(breakdown.entries()).map(([category, amount]) => {
      const info = CATEGORY_INFO[category] || { label: category };
      return `<span><strong>${escapeHTML(info.label)}:</strong> ${formatCurrency(amount)}</span>`;
    }).join("");
    $("#purchase-summary-count").textContent = `${purchases.length} purchase${purchases.length === 1 ? "" : "s"} added`;
    $("#purchase-summary-total").textContent = `${formatCurrency(total)} total`;

    const dialog = $("#purchase-summary-dialog");
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    window.setTimeout(() => $("#purchase-summary-close").focus(), 0);
  }

  function purchaseAddedBy(purchase) {
    return state.members.find((member) => member.user_id === purchase.created_by)?.display_name
      || purchase.purchased_by
      || "Household member";
  }

  function closePurchaseSummary() {
    const dialog = $("#purchase-summary-dialog");
    if (!dialog) return;
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function viewPurchaseSummaryPurchases() {
    closePurchaseSummary();
    navigate("purchases");
  }

  async function signIn(event) {
    event.preventDefault();
    const button = event.submitter;
    setBusy(button, true, "Signing in...");
    setMessage("auth-message", "");
    const { error } = await state.client.auth.signInWithPassword({
      email: $("#signin-email").value.trim(),
      password: $("#signin-password").value
    });
    setBusy(button, false);
    if (error) setMessage("auth-message", error.message);
  }

  async function signUp(event) {
    event.preventDefault();
    const button = event.submitter;
    setBusy(button, true, "Creating...");
    setMessage("auth-message", "");
    const displayName = $("#signup-name").value.trim();
    const { data, error } = await state.client.auth.signUp({
      email: $("#signup-email").value.trim(),
      password: $("#signup-password").value,
      options: { data: { display_name: displayName } }
    });
    setBusy(button, false);

    if (error) {
      setMessage("auth-message", error.message);
      return;
    }
    if (!data.session) {
      setMessage("auth-message", "Account created. Check your email to confirm it, then sign in.", true);
    } else {
      showToast("Account created.");
    }
  }

  async function createHousehold(event) {
    event.preventDefault();
    const button = event.submitter;
    setBusy(button, true, "Creating...");
    setMessage("onboarding-message", "");
    const { error } = await state.client.rpc("create_household", {
      p_name: $("#household-name").value.trim(),
      p_display_name: $("#creator-display-name").value.trim()
    });
    setBusy(button, false);
    if (error) {
      setMessage("onboarding-message", error.message);
      return;
    }
    state.initializedSessionId = null;
    await loadMembership();
    showToast("Household created.");
  }

  async function joinHousehold(event) {
    event.preventDefault();
    const button = event.submitter;
    setBusy(button, true, "Joining...");
    setMessage("onboarding-message", "");
    const { error } = await state.client.rpc("join_household", {
      p_invite_code: $("#invite-code").value.trim().toUpperCase(),
      p_display_name: $("#join-display-name").value.trim()
    });
    setBusy(button, false);
    if (error) {
      setMessage("onboarding-message", error.message);
      return;
    }
    state.initializedSessionId = null;
    await loadMembership();
    showToast("You joined the household.");
  }

  async function signOut() {
    if (!state.client) return;
    clearPurchaseSummaryTimer();
    closePurchaseSummary();
    discardTutorialSession(false);
    const { error } = await state.client.auth.signOut();
    if (error) {
      schedulePurchaseSummaryCheck();
      showToast(error.message, true);
    }
  }

  async function savePurchase(event) {
    event.preventDefault();
    if (isTutorialMode()) {
      handleTutorialPurchase(event);
      return;
    }
    if (blockTutorialProductionWrite("purchase save")) return;
    const button = event.submitter;
    setBusy(button, true, "Saving...");
    const id = $("#purchase-id").value;
    const payload = {
      household_id: state.household.id,
      created_by: state.user.id,
      amount: Number($("#purchase-amount").value),
      category: $("#purchase-category").value,
      purchase_date: $("#purchase-date").value,
      purchased_by: $("#purchase-person").value,
      store: nullIfEmpty($("#purchase-store").value),
      notes: nullIfEmpty($("#purchase-notes").value)
    };

    let result;
    if (id) {
      delete payload.created_by;
      result = await runProductionMutation(
        "purchase update",
        () => state.client.from("purchases").update(payload).eq("id", id).eq("household_id", state.household.id)
      );
    } else {
      result = await runProductionMutation("purchase insert", () => state.client.from("purchases").insert(payload));
    }
    setBusy(button, false);

    if (result.error) {
      showToast(result.error.message, true);
      return;
    }
    await loadPurchases();
    resetPurchaseForm();
    renderDashboard();
    renderPurchaseHistory();
    showToast(id ? "Purchase updated." : "Purchase saved.");
  }

  async function handlePurchaseAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (blockTutorialProductionWrite("purchase change")) return;
    const purchase = state.purchases.find((item) => item.id === button.dataset.id);
    if (!purchase) return;

    if (button.dataset.action === "edit-purchase") {
      $("#purchase-id").value = purchase.id;
      $("#purchase-amount").value = Number(purchase.amount).toFixed(2);
      $("#purchase-category").value = purchase.category;
      $("#purchase-date").value = purchase.purchase_date;
      $("#purchase-person").value = purchase.purchased_by;
      $("#purchase-store").value = purchase.store || "";
      $("#purchase-notes").value = purchase.notes || "";
      $("#purchase-form-title").textContent = "Edit purchase";
      $("#purchase-submit").textContent = "Update purchase";
      $("#purchase-cancel-edit").classList.remove("hidden");
      $("#purchase-form").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (button.dataset.action === "delete-purchase") {
      if (!window.confirm(`Delete this ${formatCurrency(Number(purchase.amount))} purchase?`)) return;
      const { error } = await runProductionMutation(
        "purchase deletion",
        () => state.client.from("purchases").delete().eq("id", purchase.id).eq("household_id", state.household.id)
      );
      if (error) return showToast(error.message, true);
      await loadPurchases();
      renderDashboard();
      renderPurchaseHistory();
      showToast("Purchase deleted.");
    }
  }

  function resetPurchaseForm() {
    $("#purchase-form").reset();
    $("#purchase-id").value = "";
    $("#purchase-date").value = todayISO();
    $("#purchase-person").value = state.membership?.display_name || "";
    $("#purchase-form-title").textContent = "Add a purchase";
    $("#purchase-submit").textContent = "Save purchase";
    $("#purchase-cancel-edit").classList.add("hidden");
  }

  async function saveRecipe(event) {
    event.preventDefault();
    if (isTutorialMode()) {
      handleTutorialRecipe(event);
      return;
    }
    if (blockTutorialProductionWrite("recipe save")) return;
    const cooks = selectedCooks();
    if (!cooks.length) return showToast("Choose Kate, Oscar, or both.", true);

    const button = event.submitter;
    setBusy(button, true, "Saving...");
    const id = $("#recipe-id").value;
    const payload = {
      household_id: state.household.id,
      created_by: state.user.id,
      name: $("#recipe-name").value.trim(),
      can_cook: cooks,
      is_active: $("#recipe-active").checked,
      ingredients: nullIfEmpty($("#recipe-ingredients").value),
      instructions: nullIfEmpty($("#recipe-instructions").value)
    };

    let result;
    if (id) {
      delete payload.created_by;
      result = await runProductionMutation(
        "recipe update",
        () => state.client.from("recipes").update(payload).eq("id", id).eq("household_id", state.household.id)
      );
    } else {
      result = await runProductionMutation("recipe insert", () => state.client.from("recipes").insert(payload));
    }
    setBusy(button, false);

    if (result.error) return showToast(friendlyDuplicateError(result.error, "That recipe is already saved."), true);
    await loadRecipes();
    resetRecipeForm();
    renderRecipes();
    renderPlannerRecipeToggles();
    renderMealPlan();
    showToast(id ? "Recipe updated." : "Recipe saved.");
  }

  async function handleRecipeAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (isTutorialMode()) {
      handleTutorialRecipeAction(button);
      return;
    }
    if (blockTutorialProductionWrite("recipe change")) return;
    const recipe = state.recipes.find((item) => item.id === button.dataset.id);
    if (!recipe) return;

    if (button.dataset.action === "edit-recipe") {
      $("#recipe-id").value = recipe.id;
      $("#recipe-name").value = recipe.name;
      $("#cook-kate").checked = (recipe.can_cook || []).includes("Kate");
      $("#cook-oscar").checked = (recipe.can_cook || []).includes("Oscar");
      $("#recipe-active").checked = isRecipeEnabled(recipe);
      $("#recipe-ingredients").value = recipe.ingredients || "";
      $("#recipe-instructions").value = recipe.instructions || "";
      $("#recipe-form-title").textContent = "Edit recipe";
      $("#recipe-submit").textContent = "Update recipe";
      $("#recipe-cancel-edit").classList.remove("hidden");
      $("#recipe-form").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (button.dataset.action === "toggle-recipe") {
      const nextEnabled = !isRecipeEnabled(recipe);
      button.disabled = true;
      const { error } = await runProductionMutation(
        "recipe availability update",
        () => state.client
          .from("recipes")
          .update({ is_active: nextEnabled })
          .eq("id", recipe.id)
          .eq("household_id", state.household.id)
      );
      button.disabled = false;
      if (error) return showToast(error.message, true);

      recipe.is_active = nextEnabled;
      renderRecipes();
      renderPlannerRecipeToggles();
      renderMealPlan();
      showToast(nextEnabled ? `“${recipe.name}” can be selected again.` : `“${recipe.name}” will be skipped.`);
      return;
    }

    if (button.dataset.action === "delete-recipe") {
      if (!window.confirm(`Delete “${recipe.name}”? It will also be removed from saved meal plans.`)) return;
      const { error } = await runProductionMutation(
        "recipe deletion",
        () => state.client.from("recipes").delete().eq("id", recipe.id).eq("household_id", state.household.id)
      );
      if (error) return showToast(error.message, true);
      await loadRecipes();
      await loadPlan(state.selectedWeekStart);
      renderRecipes();
      renderPlannerRecipeToggles();
      renderMealPlan();
      showToast("Recipe deleted.");
    }
  }

  function resetRecipeForm() {
    $("#recipe-form").reset();
    $("#recipe-active").checked = true;
    $("#recipe-id").value = "";
    $("#recipe-form-title").textContent = "Add a recipe";
    $("#recipe-submit").textContent = "Save recipe";
    $("#recipe-cancel-edit").classList.add("hidden");
  }

  async function bulkImportRecipes() {
    if (blockTutorialProductionWrite("recipe bulk import")) return;
    const rawLines = $("#bulk-recipes").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const message = $("#bulk-import-message");
    message.textContent = "";
    message.classList.remove("success");
    if (!rawLines.length) return setMessage("bulk-import-message", "Paste at least one meal.");

    const parsed = [];
    const invalid = [];
    for (const line of rawLines) {
      const upper = line.toUpperCase();
      const cooks = [];
      if (/\(K\)/.test(upper) || /\(K\s*\/\s*O\)/.test(upper) || /\(B\)/.test(upper)) cooks.push("Kate");
      if (/\(O\)/.test(upper) || /\(K\s*\/\s*O\)/.test(upper) || /\(B\)/.test(upper)) cooks.push("Oscar");
      const name = line.replace(/\((?:K|O|B|K\s*\/\s*O)\)/gi, "").replace(/\s{2,}/g, " ").trim();
      if (!name || !cooks.length) {
        invalid.push(line);
        continue;
      }
      parsed.push({ name, can_cook: [...new Set(cooks)] });
    }

    if (!parsed.length) return setMessage("bulk-import-message", "No valid meals found. Add (K), (O), or both to each line.");

    const existingNames = new Set(state.recipes.map((recipe) => recipe.name.toLowerCase()));
    const seen = new Set();
    const rows = parsed.filter((recipe) => {
      const key = recipe.name.toLowerCase();
      if (existingNames.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((recipe) => ({
      household_id: state.household.id,
      created_by: state.user.id,
      name: recipe.name,
      can_cook: recipe.can_cook,
      is_active: true
    }));

    if (!rows.length) return setMessage("bulk-import-message", "Every valid meal in that list is already saved.");

    const button = $("#bulk-import-button");
    setBusy(button, true, "Importing...");
    const { error } = await runProductionMutation("recipe bulk insert", () => state.client.from("recipes").insert(rows));
    setBusy(button, false);
    if (error) return setMessage("bulk-import-message", error.message);

    await loadRecipes();
    renderRecipes();
    renderPlannerRecipeToggles();
    renderMealPlan();
    $("#bulk-recipes").value = "";
    const skipped = parsed.length - rows.length;
    const invalidText = invalid.length ? ` ${invalid.length} line${invalid.length === 1 ? " was" : "s were"} missing a valid cook tag.` : "";
    setMessage("bulk-import-message", `Imported ${rows.length} meal${rows.length === 1 ? "" : "s"}.${skipped ? ` Skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}.` : ""}${invalidText}`, true);
  }

  async function generateMealPlan() {
    if (blockTutorialProductionWrite("meal plan generation")) return;
    const enabledRecipes = state.recipes.filter(isRecipeEnabled);
    if (enabledRecipes.length < DAY_NAMES.length) {
      return showToast(`Enable at least seven meals first. You currently have ${enabledRecipes.length} enabled.`, true);
    }
    const button = $("#generate-meals");
    setBusy(button, true, "Choosing meals...");

    const chosen = shuffle([...enabledRecipes]).slice(0, DAY_NAMES.length);
    const cookCounts = { Kate: 0, Oscar: 0 };
    const rows = chosen.map((recipe, dayIndex) => ({
      household_id: state.household.id,
      week_start: state.selectedWeekStart,
      day_index: dayIndex,
      plan_type: "recipe",
      recipe_id: recipe.id,
      assigned_cook: chooseBalancedCook(recipe.can_cook || [], cookCounts),
      created_by: state.user.id
    }));

    const { error } = await runProductionMutation(
      "meal plan generation",
      () => state.client
        .from("meal_plans")
        .upsert(rows, { onConflict: "household_id,week_start,day_index" })
    );
    setBusy(button, false);
    if (error) return showToast(error.message, true);

    await loadPlan(state.selectedWeekStart);
    showToast("Seven meals selected.");
  }

  async function handleMealSelection(event) {
    const select = event.target.closest("select[data-action='select-meal']");
    if (!select) return;
    if (blockTutorialProductionWrite("meal plan selection")) {
      renderMealPlan();
      return;
    }

    const dayIndex = Number(select.dataset.day);
    const previousValue = select.dataset.previousValue || "";
    const selectedValue = select.value;
    if (!selectedValue || selectedValue === previousValue) return;

    const currentItem = state.plan.find((item) => item.day_index === dayIndex);
    let payload;
    if (selectedValue === "eat_out") {
      payload = {
        plan_type: "eat_out",
        recipe_id: null,
        assigned_cook: "Eating Out"
      };
    } else {
      const recipe = state.recipes.find((item) => item.id === selectedValue);
      if (!recipe) {
        select.value = previousValue;
        return showToast("That recipe is no longer available.", true);
      }
      payload = {
        plan_type: "recipe",
        recipe_id: recipe.id,
        assigned_cook: chooseManualCook(recipe, currentItem, dayIndex)
      };
    }

    select.disabled = true;
    const { error } = await runProductionMutation(
      "meal plan selection",
      () => state.client.from("meal_plans").upsert({
        household_id: state.household.id,
        week_start: state.selectedWeekStart,
        day_index: dayIndex,
        ...payload,
        created_by: state.user.id
      }, { onConflict: "household_id,week_start,day_index" })
    );

    if (error) {
      select.disabled = false;
      select.value = previousValue;
      return showToast(error.message, true);
    }

    await loadPlan(state.selectedWeekStart);
    showToast(`${DAY_NAMES[dayIndex]} saved.`);
  }

  async function handleMealAction(event) {
    const button = event.target.closest("button[data-action='reroll-meal']");
    if (!button) return;
    if (blockTutorialProductionWrite("meal plan reroll")) return;
    const dayIndex = Number(button.dataset.day);
    const currentItem = state.plan.find((item) => item.day_index === dayIndex);
    const usedRecipeIds = new Set(state.plan
      .filter((item) => item.day_index !== dayIndex && item.plan_type !== "eat_out" && item.recipe_id)
      .map((item) => item.recipe_id));
    const options = state.recipes.filter((recipe) => isRecipeEnabled(recipe) && !usedRecipeIds.has(recipe.id) && recipe.id !== currentItem?.recipe_id);
    if (!options.length) return showToast("Enable another unused meal before rerolling this day.", true);

    button.disabled = true;
    const recipe = options[Math.floor(Math.random() * options.length)];
    const cookCounts = { Kate: 0, Oscar: 0 };
    state.plan.filter((item) => item.day_index !== dayIndex).forEach((item) => {
      if (cookCounts[item.assigned_cook] !== undefined) cookCounts[item.assigned_cook] += 1;
    });
    const assignedCook = chooseBalancedCook(recipe.can_cook || [], cookCounts);

    const { error } = await runProductionMutation(
      "meal plan reroll",
      () => state.client.from("meal_plans").upsert({
        household_id: state.household.id,
        week_start: state.selectedWeekStart,
        day_index: dayIndex,
        plan_type: "recipe",
        recipe_id: recipe.id,
        assigned_cook: assignedCook,
        created_by: state.user.id
      }, { onConflict: "household_id,week_start,day_index" })
    );
    button.disabled = false;
    if (error) return showToast(error.message, true);
    await loadPlan(state.selectedWeekStart);
    showToast(`${DAY_NAMES[dayIndex]} rerolled.`);
  }

  async function changeWeek(days) {
    const date = parseISODate(state.selectedWeekStart);
    date.setDate(date.getDate() + days);
    state.selectedWeekStart = toISODate(date);
    await loadPlan(state.selectedWeekStart);
  }

  function isRecipeEnabled(recipe) {
    return recipe?.is_active !== false;
  }

  function chooseBalancedCook(eligible, counts) {
    const cooks = eligible.filter((name) => name === "Kate" || name === "Oscar");
    if (!cooks.length) return "Either";
    const minimum = Math.min(...cooks.map((name) => counts[name] || 0));
    const tied = cooks.filter((name) => (counts[name] || 0) === minimum);
    const selected = tied[Math.floor(Math.random() * tied.length)];
    counts[selected] = (counts[selected] || 0) + 1;
    return selected;
  }

  function chooseManualCook(recipe, currentItem, dayIndex) {
    const eligible = (recipe.can_cook || []).filter((name) => name === "Kate" || name === "Oscar");
    if (eligible.length === 1) return eligible[0];
    if (eligible.includes(currentItem?.assigned_cook)) return currentItem.assigned_cook;

    const cookCounts = { Kate: 0, Oscar: 0 };
    state.plan.filter((item) => item.day_index !== dayIndex && item.plan_type !== "eat_out").forEach((item) => {
      if (cookCounts[item.assigned_cook] !== undefined) cookCounts[item.assigned_cook] += 1;
    });
    return chooseBalancedCook(eligible, cookCounts);
  }

  async function saveGroceryItem(event) {
    event.preventDefault();
    if (isTutorialMode()) {
      handleTutorialGroceryItem(event);
      return;
    }
    if (blockTutorialProductionWrite("grocery item save")) return;
    const button = event.submitter;
    const name = $("#grocery-name").value.trim();
    if (!name) return showToast("Enter an item name.", true);
    setBusy(button, true, "Adding...");
    const estimateValue = $("#grocery-estimate").value;
    const payload = {
      household_id: state.household.id,
      created_by: state.user.id,
      name,
      category: $("#grocery-category").value,
      quantity: nullIfEmpty($("#grocery-quantity").value),
      estimated_price: estimateValue === "" ? null : Number(estimateValue),
      source: "manual"
    };
    const { error } = await runProductionMutation("grocery item insert", () => state.client.from("grocery_items").insert(payload));
    setBusy(button, false);
    if (error) return showToast(error.message, true);
    event.target.reset();
    $("#grocery-category").value = "food";
    await loadGroceryItems();
    renderGroceryList();
    renderGrocerySummary();
    showToast("Item added to the grocery list.");
  }

  function renderGroceryList() {
    const container = $("#grocery-list");
    if (!container) return;
    const filter = $("#grocery-filter")?.value || "all";
    const items = displayedGroceryItems().filter((item) => filter === "all" || (filter === "collected" ? item.is_collected : !item.is_collected));
    if (!items.length) {
      container.className = "grocery-list empty-state";
      container.textContent = filter === "all" ? "No grocery items yet." : "No items in this view.";
      return;
    }
    container.className = "grocery-list";
    container.innerHTML = items.map((item) => {
      const estimate = item.estimated_price == null ? "" : `<span>Est. ${formatCurrency(item.estimated_price)}</span>`;
      const actual = item.actual_price == null ? "" : `<span>Paid ${formatCurrency(item.actual_price)}</span>`;
      const source = item.source === "recipe" ? `<span class="source-tag">${isTutorialMode() ? "From Taco Night" : "From meal plan"}</span>` : "";
      const sale = item.is_sale ? `<span class="sale-tag">Sale</span>` : "";
      const tutorialTarget = isTutorialMode() && item.name === "Ground Beef" ? ' data-tutorial-target="ground-beef-collect"' : "";
      return `<article class="grocery-item${item.is_collected ? " is-collected" : ""}">
        <button class="grocery-check" type="button" data-action="${item.is_collected ? "uncollect-grocery" : "collect-grocery"}" data-id="${item.id}" aria-label="${item.is_collected ? "Mark needed" : "Collect item"}"${tutorialTarget}>${item.is_collected ? "✓" : ""}</button>
        <div class="grocery-item-copy">
          <div class="grocery-item-title"><h3>${escapeHTML(item.name)}</h3>${sale}${source}</div>
          <p>${escapeHTML(groceryCategoryLabel(item.category))}${item.quantity ? ` · ${escapeHTML(item.quantity)}` : ""}</p>
          <div class="grocery-price-row">${estimate}${actual}</div>
        </div>
        <button class="mini-action delete${isTutorialMode() ? " hidden" : ""}" type="button" data-action="delete-grocery" data-id="${item.id}">Delete</button>
      </article>`;
    }).join("");
  }

  function renderGrocerySummary() {
    if (!$("#grocery-estimated-total")) return;
    const groceryItems = displayedGroceryItems();
    const groceryBudget = displayedGroceryBudget();
    const needed = groceryItems.filter((item) => !item.is_collected);
    const collected = groceryItems.filter((item) => item.is_collected);
    const estimatedTotal = sum(groceryItems.map((item) => item.estimated_price));
    const actualTotal = sum(collected.map((item) => item.actual_price));
    const remainingEstimate = sum(needed.map((item) => item.estimated_price));
    $("#grocery-estimated-total").textContent = formatCurrency(estimatedTotal);
    $("#grocery-actual-total").textContent = formatCurrency(actualTotal);
    $("#grocery-remaining-total").textContent = formatCurrency(remainingEstimate);
    $("#grocery-budget").value = groceryBudget == null ? "" : groceryBudget.toFixed(2);
    $("#grocery-budget-left").textContent = groceryBudget == null ? "—" : formatCurrency(groceryBudget - actualTotal - remainingEstimate);
    const sales = collected.filter((item) => item.is_sale).length;
    $("#grocery-sale-summary").textContent = `${sales} sale item${sales === 1 ? "" : "s"} collected · ${needed.length} item${needed.length === 1 ? "" : "s"} still needed`;
  }

  async function handleGroceryAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (isTutorialMode()) {
      handleTutorialGroceryAction(button);
      return;
    }
    if (blockTutorialProductionWrite("grocery item change")) return;
    const item = state.groceryItems.find((entry) => entry.id === button.dataset.id);
    if (!item) return;
    if (button.dataset.action === "collect-grocery") {
      const priceText = window.prompt(`Enter the price paid for ${item.name}:`, item.estimated_price ?? "");
      if (priceText === null) return;
      const price = Number(priceText);
      if (!Number.isFinite(price) || price < 0) return showToast("Enter a valid price.", true);
      const sale = window.confirm("Was this a sale price? Press OK for Yes or Cancel for No.");
      const { error } = await runProductionMutation(
        "grocery collection update",
        () => state.client.from("grocery_items").update({ is_collected: true, actual_price: price, is_sale: sale, collected_at: new Date().toISOString() }).eq("id", item.id).eq("household_id", state.household.id)
      );
      if (error) return showToast(error.message, true);
    } else if (button.dataset.action === "uncollect-grocery") {
      const { error } = await runProductionMutation(
        "grocery collection reset",
        () => state.client.from("grocery_items").update({ is_collected: false, actual_price: null, is_sale: false, collected_at: null }).eq("id", item.id).eq("household_id", state.household.id)
      );
      if (error) return showToast(error.message, true);
    } else if (button.dataset.action === "delete-grocery") {
      if (!window.confirm(`Delete ${item.name} from the grocery list?`)) return;
      const { error } = await runProductionMutation(
        "grocery item deletion",
        () => state.client.from("grocery_items").delete().eq("id", item.id).eq("household_id", state.household.id)
      );
      if (error) return showToast(error.message, true);
    }
    await loadGroceryItems();
    renderGroceryList();
    renderGrocerySummary();
  }

  async function saveGroceryBudget() {
    if (blockTutorialProductionWrite("grocery budget update")) {
      renderGrocerySummary();
      return;
    }
    const value = $("#grocery-budget").value;
    const amount = value === "" ? null : Number(value);
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) return showToast("Enter a valid budget.", true);
    const payload = { household_id: state.household.id, amount, updated_by: state.user.id };
    const { error } = await runProductionMutation(
      "grocery budget update",
      () => state.client.from("grocery_budgets").upsert(payload, { onConflict: "household_id" })
    );
    if (error) return showToast(error.message, true);
    state.groceryBudget = amount;
    renderGrocerySummary();
    showToast("Shopping budget saved.");
  }

  async function addPlanIngredientsToGrocery() {
    if (blockTutorialProductionWrite("meal ingredient import")) return;
    const button = $("#add-plan-ingredients");
    setMessage("ingredient-import-message", "");
    setBusy(button, true, "Adding...");
    const { data: planRows, error: planError } = await state.client
      .from("meal_plans")
      .select("plan_type, recipe_id, recipes(name, ingredients)")
      .eq("household_id", state.household.id)
      .eq("week_start", state.currentWeekStart);
    if (planError) { setBusy(button, false); return showToast(planError.message, true); }
    const existing = new Set(state.groceryItems.filter((item) => !item.is_collected).map((item) => normalizeItemName(item.name)));
    const additions = [];
    for (const row of planRows || []) {
      if (row.plan_type === "eat_out" || !row.recipe_id) continue;
      const recipe = Array.isArray(row.recipes) ? row.recipes[0] : row.recipes;
      const lines = String(recipe?.ingredients || "").split(/\r?\n/).map((line) => line.trim().replace(/^[-•*]\s*/, "")).filter(Boolean);
      for (const line of lines) {
        const normalized = normalizeItemName(line);
        if (!normalized || existing.has(normalized)) continue;
        existing.add(normalized);
        additions.push({ household_id: state.household.id, created_by: state.user.id, name: line.slice(0, 120), category: "food", source: "recipe", recipe_id: row.recipe_id, meal_plan_week_start: state.currentWeekStart });
      }
    }
    if (!additions.length) {
      setBusy(button, false);
      setMessage("ingredient-import-message", "No new ingredients were found. Add ingredient lines to your recipes first.");
      return;
    }
    const { error } = await runProductionMutation("meal ingredient insert", () => state.client.from("grocery_items").insert(additions));
    setBusy(button, false);
    if (error) return showToast(error.message, true);
    await loadGroceryItems();
    renderGroceryList();
    renderGrocerySummary();
    setMessage("ingredient-import-message", `${additions.length} ingredient${additions.length === 1 ? "" : "s"} added.`, true);
  }

  async function clearCollectedGroceryItems() {
    if (blockTutorialProductionWrite("collected grocery deletion")) return;
    const count = state.groceryItems.filter((item) => item.is_collected).length;
    if (!count) return showToast("There are no collected items to clear.");
    if (!window.confirm(`Remove ${count} collected item${count === 1 ? "" : "s"} from the list?`)) return;
    const { error } = await runProductionMutation(
      "collected grocery deletion",
      () => state.client.from("grocery_items").delete().eq("household_id", state.household.id).eq("is_collected", true)
    );
    if (error) return showToast(error.message, true);
    await loadGroceryItems();
    renderGroceryList();
    renderGrocerySummary();
  }

  function groceryCategoryLabel(value) {
    return ({ food: "Food", cleaning: "Cleaning supplies", household: "Household", other: "Other" })[value] || "Other";
  }

  function createEmptyTutorialState() {
    return {
      active: false,
      step: 0,
      purchases: [],
      recipes: [],
      groceryItems: [],
      groceryBudget: null,
      completedSteps: new Set(),
      recipeToggleOffSeen: false,
      previousFocus: null
    };
  }

  function isTutorialMode() {
    return tutorialState.active === true;
  }

  function blockTutorialProductionWrite(operation) {
    if (!isTutorialMode()) return false;
    console.warn(`[Practice Mode] Blocked production write: ${operation}.`);
    showToast("That action is unavailable in Practice Mode. Your real household data is safe.", true);
    return true;
  }

  async function runProductionMutation(operation, request) {
    if (blockTutorialProductionWrite(operation)) {
      return { data: null, error: new Error("Production write blocked in Practice Mode.") };
    }
    state.productionWritesPending += 1;
    try {
      return await request();
    } finally {
      state.productionWritesPending = Math.max(0, state.productionWritesPending - 1);
    }
  }

  function renderTutorialHelp() {
    if (!state.membership) return;
    const completed = state.membership.tutorial_completed === true;
    $("#tutorial-help-status").textContent = completed ? "Completed ✓" : "Ready when you are.";
    $("#tutorial-start-button").textContent = completed ? "Replay Tutorial" : "Start Tutorial";
    const completedAt = $("#tutorial-help-completed-at");
    if (completed && state.membership.tutorial_completed_at) {
      const parsed = new Date(state.membership.tutorial_completed_at);
      completedAt.textContent = Number.isNaN(parsed.getTime())
        ? ""
        : `Last completed: ${new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(parsed)}`;
      completedAt.classList.toggle("hidden", !completedAt.textContent);
    } else {
      completedAt.textContent = "";
      completedAt.classList.add("hidden");
    }
  }

  async function maybeShowTutorialPrompt() {
    if (
      !state.session ||
      !state.membership ||
      state.membership.tutorial_prompt_seen === true ||
      isTutorialMode()
    ) return false;

    openTutorialDialog($("#tutorial-welcome-dialog"));
    window.setTimeout(() => $("#tutorial-welcome-start").focus(), 0);
    return true;
  }

  async function saveTutorialStatus({ promptSeen = null, completed = null }) {
    const expectedUserId = state.user?.id;
    const expectedMembership = state.membership;
    if (!expectedUserId || !expectedMembership) return false;
    const { data, error } = await state.client.rpc("update_tutorial_status", {
      p_prompt_seen: promptSeen,
      p_completed: completed
    });
    if (error) {
      showToast(`Tutorial progress could not be saved: ${error.message}`, true);
      return false;
    }
    if (state.user?.id !== expectedUserId || state.membership !== expectedMembership) return false;

    const saved = Array.isArray(data) ? data[0] : data;
    state.membership.tutorial_prompt_seen = saved?.tutorial_prompt_seen
      ?? Boolean(state.membership.tutorial_prompt_seen || promptSeen || completed);
    state.membership.tutorial_completed = saved?.tutorial_completed
      ?? Boolean(state.membership.tutorial_completed || completed);
    state.membership.tutorial_completed_at = saved?.tutorial_completed_at
      ?? state.membership.tutorial_completed_at
      ?? (completed ? new Date().toISOString() : null);
    renderTutorialHelp();
    return true;
  }

  async function startTutorialFromWelcome(event) {
    if (!canStartTutorial()) return;
    const button = event.currentTarget;
    setBusy(button, true, "Starting...");
    const saved = await saveTutorialStatus({ promptSeen: true });
    setBusy(button, false);
    if (!saved) return;
    closeTutorialDialog($("#tutorial-welcome-dialog"));
    beginTutorialSession();
  }

  async function dismissTutorialWelcome(event) {
    const button = event.currentTarget;
    setBusy(button, true, "Saving...");
    const saved = await saveTutorialStatus({ promptSeen: true });
    setBusy(button, false);
    if (!saved) return;
    closeTutorialDialog($("#tutorial-welcome-dialog"));
    schedulePurchaseSummaryCheck();
  }

  async function startTutorialFromSettings(event) {
    const button = event.currentTarget;
    if (isTutorialMode()) return;
    if (!canStartTutorial()) return;
    if (state.membership?.tutorial_prompt_seen !== true) {
      setBusy(button, true, "Starting...");
      const saved = await saveTutorialStatus({ promptSeen: true });
      setBusy(button, false);
      if (!saved) return;
    }
    beginTutorialSession();
  }

  function canStartTutorial() {
    if (state.productionWritesPending === 0) return true;
    showToast("Please wait for the current save to finish, then start the tutorial again.", true);
    return false;
  }

  function beginTutorialSession(previousFocusOverride = null) {
    if (state.productionWritesPending > 0) {
      showToast("Please wait for the current save to finish, then start the tutorial again.", true);
      return false;
    }
    const previousFocus = previousFocusOverride || document.activeElement;
    tutorialState = createEmptyTutorialState();
    tutorialState.active = true;
    tutorialState.previousFocus = previousFocus;
    document.body.classList.add("tutorial-active");
    clearPurchaseSummaryTimer();
    closePurchaseSummary();
    closeTutorialDialog($("#tutorial-welcome-dialog"));
    $("#tutorial-mode-banner").classList.remove("hidden");
    $("#tutorial-panel").classList.remove("hidden");
    $("#purchase-month-filter").value = currentMonthValue();
    $("#purchase-category-filter").value = "all";
    $("#recipe-search").value = "";
    $("#grocery-filter").value = "all";
    resetPurchaseForm();
    resetRecipeForm();
    $("#grocery-form").reset();
    renderTutorialViews();
    showTutorialStep(0);
    return true;
  }

  function renderTutorialViews() {
    renderDashboard();
    renderPurchaseHistory();
    renderRecipes();
    renderPlannerRecipeToggles();
    renderGroceryList();
    renderGrocerySummary();
  }

  function tutorialStepDefinition(step) {
    return [
      {
        page: "dashboard",
        title: "Welcome to your Household Hub!",
        copy: "<p>You can track household spending, save recipes, plan meals, and manage your grocery list all in one place.</p>",
        primary: "Let's Go"
      },
      {
        page: "purchases",
        title: "Let's add a practice purchase.",
        copy: "<p>The sample fields are ready for you:</p><ul><li><strong>Amount:</strong> $24.50</li><li><strong>Category:</strong> Entertainment</li><li><strong>Store:</strong> Movie Night</li></ul><p>Review them, then press the normal <strong>Add Purchase</strong> button.</p>",
        target: "#purchase-submit",
        interactive: true
      },
      {
        page: "dashboard",
        title: "Great! Your totals updated.",
        copy: "<p>Purchases are shared with your household and automatically count toward monthly totals.</p><p>The Entertainment total and average now show <strong>$24.50</strong>.</p>",
        target: ".entertainment-card",
        primary: "Continue"
      },
      {
        page: "recipes",
        title: "Now let's save a recipe.",
        copy: "<p>The form contains <strong>Taco Night</strong>, both household cooks, and four ingredients. Review it, then press <strong>Save recipe</strong>.</p>",
        target: "#recipe-submit",
        interactive: true
      },
      {
        page: "recipes",
        title: "Control recipe availability.",
        copy: "<p>Recipes can be used in your meal planner, and their ingredients can be sent to your grocery list.</p><p>Toggle Taco Night <strong>off</strong>, then turn it <strong>back on</strong>. Enabled recipes can be selected when Household Hub randomizes meals. Manual meal selection keeps following the app's normal saved-recipe behavior.</p>",
        target: "[data-tutorial-target='recipe-toggle']",
        interactive: true
      },
      {
        page: "recipes",
        title: "Send ingredients to groceries.",
        copy: "<p>Press <strong>Add Ingredients to Grocery List</strong> on Taco Night. Its four practice ingredients will be added without contacting Supabase.</p>",
        target: "[data-tutorial-target='recipe-ingredients-import']",
        interactive: true
      },
      {
        page: "grocery",
        title: "You can also add anything manually.",
        copy: "<p><strong>Paper Towels</strong> is ready with the <strong>Cleaning supplies</strong> category. Press <strong>Add to list</strong>.</p>",
        target: "#grocery-submit",
        interactive: true
      },
      {
        page: "grocery",
        title: "Collect a grocery item.",
        copy: "<p>Check off <strong>Ground Beef</strong> and enter <strong>$6.99</strong> as the actual price.</p><p>Household Hub can compare what you planned to spend with what you actually spent.</p>",
        target: "[data-tutorial-target='ground-beef-collect']",
        interactive: true
      },
      {
        page: "dashboard",
        title: "You're ready! 🎉",
        copy: "<p>You just learned how to:</p><ul class='tutorial-completion-list'><li>✓ Add a purchase</li><li>✓ Track category totals</li><li>✓ Save a recipe</li><li>✓ Control recipe availability</li><li>✓ Send recipe ingredients to groceries</li><li>✓ Add grocery items manually</li><li>✓ Record the actual price when shopping</li></ul>",
        primary: "Finish Tutorial"
      }
    ][step];
  }

  function prepareTutorialStep(step) {
    if (step === 1 && !tutorialState.completedSteps.has(1)) {
      resetPurchaseForm();
      $("#purchase-amount").value = "24.50";
      $("#purchase-category").value = "entertainment";
      $("#purchase-date").value = todayISO();
      $("#purchase-person").value = state.membership.display_name;
      $("#purchase-store").value = "Movie Night";
      $("#purchase-submit").textContent = "Add Purchase";
    }
    if (step === 3 && !tutorialState.completedSteps.has(3)) {
      resetRecipeForm();
      $("#recipe-name").value = "Taco Night";
      $("#cook-kate").checked = true;
      $("#cook-oscar").checked = true;
      $("#recipe-active").checked = true;
      $("#recipe-ingredients").value = "Tortillas\nGround Beef\nCheese\nLettuce";
    }
    if (step === 6 && !tutorialState.completedSteps.has(6)) {
      $("#grocery-form").reset();
      $("#grocery-name").value = "Paper Towels";
      $("#grocery-category").value = "cleaning";
    }
  }

  function showTutorialStep(step) {
    if (!isTutorialMode()) return;
    const nextStep = Math.max(0, Math.min(step, TUTORIAL_TOTAL_STEPS - 1));
    tutorialState.step = nextStep;
    prepareTutorialStep(nextStep);
    renderTutorialViews();
    const definition = tutorialStepDefinition(nextStep);
    navigate(definition.page);

    $("#tutorial-step-label").textContent = `Step ${nextStep + 1} of ${TUTORIAL_TOTAL_STEPS}`;
    $("#tutorial-progress").value = nextStep + 1;
    $("#tutorial-progress").textContent = `${nextStep + 1} of ${TUTORIAL_TOTAL_STEPS}`;
    $("#tutorial-panel-title").textContent = definition.title;
    $("#tutorial-panel-copy").innerHTML = definition.copy;
    $("#tutorial-back-button").classList.toggle("hidden", nextStep === 0);
    $("#tutorial-restart-button").classList.toggle("hidden", nextStep !== TUTORIAL_TOTAL_STEPS - 1);
    const actionReady = !definition.interactive || tutorialState.completedSteps.has(nextStep);
    const primary = $("#tutorial-primary-button");
    primary.classList.toggle("hidden", !actionReady);
    primary.textContent = definition.primary || "Continue";
    $("#tutorial-panel").classList.remove("hidden");
    $("#tutorial-announcement").textContent = `${$("#tutorial-step-label").textContent}. ${definition.title} ${$("#tutorial-panel-copy").textContent}`;
    setTutorialTarget(
      definition.target || null,
      definition.interactive ? definition.target : "#tutorial-primary-button"
    );
  }

  function handleTutorialPrimaryAction() {
    if (!isTutorialMode()) return;
    if (tutorialState.step === TUTORIAL_TOTAL_STEPS - 1) {
      void finishTutorial();
      return;
    }
    if (tutorialStepDefinition(tutorialState.step).interactive && !tutorialState.completedSteps.has(tutorialState.step)) return;
    showTutorialStep(tutorialState.step + 1);
  }

  function tutorialBack() {
    if (!isTutorialMode() || tutorialState.step === 0) return;
    showTutorialStep(tutorialState.step - 1);
  }

  function handleTutorialPurchase(event) {
    if (tutorialState.step !== 1) {
      showToast("Follow the highlighted tutorial step first.", true);
      return;
    }
    const amount = Number($("#purchase-amount").value);
    const category = $("#purchase-category").value;
    const store = $("#purchase-store").value.trim();
    if (Math.abs(amount - 24.5) > 0.001 || category !== "entertainment" || store.toLowerCase() !== "movie night") {
      showToast("Use $24.50, Entertainment, and Movie Night for this practice purchase.", true);
      return;
    }

    const now = new Date().toISOString();
    tutorialState.purchases = [{
      id: "tutorial-purchase-movie-night",
      amount: 24.5,
      category: "entertainment",
      purchase_date: $("#purchase-date").value || todayISO(),
      purchased_by: $("#purchase-person").value || state.membership.display_name,
      store: "Movie Night",
      notes: nullIfEmpty($("#purchase-notes").value),
      created_by: state.user.id,
      created_at: now
    }];
    tutorialState.completedSteps.add(1);
    renderDashboard();
    renderPurchaseHistory();
    showToast("Practice purchase saved.");
    window.setTimeout(() => showTutorialStep(2), 450);
  }

  function handleTutorialRecipe() {
    if (tutorialState.step !== 3) {
      showToast("Follow the highlighted tutorial step first.", true);
      return;
    }
    const name = $("#recipe-name").value.trim();
    const cooks = selectedCooks();
    const ingredients = $("#recipe-ingredients").value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const requiredIngredients = ["tortillas", "ground beef", "cheese", "lettuce"];
    if (
      name.toLowerCase() !== "taco night" ||
      !cooks.length ||
      !requiredIngredients.every((required) => ingredients.some((item) => item.toLowerCase() === required))
    ) {
      showToast("Use Taco Night, at least one cook, and all four practice ingredients.", true);
      return;
    }

    tutorialState.recipes = [{
      id: "tutorial-recipe-taco-night",
      household_id: "tutorial",
      created_by: state.user.id,
      name: "Taco Night",
      can_cook: cooks,
      is_active: true,
      ingredients: "Tortillas\nGround Beef\nCheese\nLettuce",
      instructions: nullIfEmpty($("#recipe-instructions").value),
      created_at: new Date().toISOString()
    }];
    tutorialState.completedSteps.add(3);
    renderRecipes();
    renderPlannerRecipeToggles();
    showToast("Practice recipe saved.");
    window.setTimeout(() => showTutorialStep(4), 450);
  }

  function handleTutorialRecipeAction(button) {
    const recipe = tutorialState.recipes.find((item) => item.id === button.dataset.id);
    if (!recipe) return;

    if (button.dataset.action === "tutorial-add-recipe-ingredients") {
      if (tutorialState.step !== 5) {
        showToast("First complete the current practice step.", true);
        return;
      }
      addTutorialRecipeIngredients(recipe);
      return;
    }

    if (button.dataset.action !== "toggle-recipe") {
      blockTutorialProductionWrite("recipe edit or deletion");
      return;
    }
    if (tutorialState.step !== 4) {
      showToast("Use the toggle when the tutorial highlights it.", true);
      return;
    }

    recipe.is_active = !isRecipeEnabled(recipe);
    let completedNow = false;
    if (!recipe.is_active) {
      tutorialState.recipeToggleOffSeen = true;
      showToast("Taco Night is off. Now turn it back on.");
    } else if (tutorialState.recipeToggleOffSeen) {
      tutorialState.completedSteps.add(4);
      completedNow = true;
      showToast("Taco Night is enabled again.");
    }
    renderRecipes();
    renderPlannerRecipeToggles();
    setTutorialTarget("[data-tutorial-target='recipe-toggle']");
    if (completedNow) window.setTimeout(() => showTutorialStep(5), 450);
  }

  function addTutorialRecipeIngredients(recipe) {
    const estimates = { "Tortillas": 3.5, "Ground Beef": 8, "Cheese": 4.25, "Lettuce": 2 };
    const existingNames = new Set(tutorialState.groceryItems.map((item) => normalizeItemName(item.name)));
    const additions = recipe.ingredients.split(/\r?\n/).map((name) => name.trim()).filter(Boolean).filter((name) => !existingNames.has(normalizeItemName(name))).map((name, index) => ({
      id: `tutorial-grocery-recipe-${index}`,
      household_id: "tutorial",
      created_by: state.user.id,
      name,
      category: "food",
      quantity: null,
      estimated_price: estimates[name] ?? null,
      actual_price: null,
      is_collected: false,
      is_sale: false,
      source: "recipe",
      recipe_id: recipe.id,
      created_at: new Date().toISOString()
    }));
    tutorialState.groceryItems.push(...additions);
    tutorialState.completedSteps.add(5);
    renderGroceryList();
    renderGrocerySummary();
    showToast("Four practice ingredients added.");
    window.setTimeout(() => showTutorialStep(6), 450);
  }

  function handleTutorialGroceryItem() {
    if (tutorialState.step !== 6) {
      showToast("Follow the highlighted tutorial step first.", true);
      return;
    }
    const name = $("#grocery-name").value.trim();
    const category = $("#grocery-category").value;
    if (name.toLowerCase() !== "paper towels" || !["cleaning", "household"].includes(category)) {
      showToast("Use Paper Towels and Cleaning supplies (or Household) for this practice item.", true);
      return;
    }

    const item = {
      id: "tutorial-grocery-paper-towels",
      household_id: "tutorial",
      created_by: state.user.id,
      name: "Paper Towels",
      category,
      quantity: nullIfEmpty($("#grocery-quantity").value),
      estimated_price: $("#grocery-estimate").value === "" ? null : Number($("#grocery-estimate").value),
      actual_price: null,
      is_collected: false,
      is_sale: false,
      source: "manual",
      created_at: new Date().toISOString()
    };
    tutorialState.groceryItems = tutorialState.groceryItems.filter((entry) => entry.id !== item.id);
    tutorialState.groceryItems.push(item);
    tutorialState.completedSteps.add(6);
    renderGroceryList();
    renderGrocerySummary();
    showToast("Practice grocery item added.");
    window.setTimeout(() => showTutorialStep(7), 450);
  }

  function handleTutorialGroceryAction(button) {
    const item = tutorialState.groceryItems.find((entry) => entry.id === button.dataset.id);
    if (!item) return;
    if (button.dataset.action !== "collect-grocery" || item.name !== "Ground Beef") {
      blockTutorialProductionWrite("unexpected grocery change");
      return;
    }
    if (tutorialState.step !== 7) {
      showToast("Collect Ground Beef when the tutorial highlights it.", true);
      return;
    }

    $("#tutorial-actual-price").value = "6.99";
    $("#tutorial-sale-price").checked = false;
    openTutorialDialog($("#tutorial-price-dialog"));
    window.setTimeout(() => $("#tutorial-actual-price").focus(), 0);
  }

  function completeTutorialGroceryCollection(event) {
    event.preventDefault();
    if (!isTutorialMode() || tutorialState.step !== 7) return;
    const item = tutorialState.groceryItems.find((entry) => entry.name === "Ground Beef");
    if (!item) return;
    const price = Number($("#tutorial-actual-price").value);
    if (!Number.isFinite(price) || Math.abs(price - 6.99) > 0.001) {
      showToast("Enter $6.99 for this practice item.", true);
      return;
    }
    item.is_collected = true;
    item.actual_price = 6.99;
    item.is_sale = $("#tutorial-sale-price").checked;
    item.collected_at = new Date().toISOString();
    tutorialState.completedSteps.add(7);
    closeTutorialDialog($("#tutorial-price-dialog"));
    renderGroceryList();
    renderGrocerySummary();
    showToast("Ground Beef collected for $6.99.");
    window.setTimeout(() => showTutorialStep(8), 450);
  }

  function closeTutorialPriceDialog() {
    closeTutorialDialog($("#tutorial-price-dialog"));
    window.setTimeout(() => tutorialTargetElement?.focus({ preventScroll: true }), 0);
  }

  function requestTutorialExit() {
    if (!isTutorialMode()) return;
    openTutorialDialog($("#tutorial-exit-dialog"));
    window.setTimeout(() => $("#tutorial-keep-learning").focus(), 0);
  }

  function keepLearning() {
    closeTutorialDialog($("#tutorial-exit-dialog"));
    window.setTimeout(() => $("#tutorial-panel").focus(), 0);
  }

  function confirmTutorialExit() {
    closeTutorialDialog($("#tutorial-exit-dialog"));
    discardTutorialSession(true);
    showToast("Practice progress discarded. You can restart from Settings anytime.");
  }

  async function finishTutorial() {
    const button = $("#tutorial-primary-button");
    setBusy(button, true, "Finishing...");
    const saved = await saveTutorialStatus({ promptSeen: true, completed: true });
    setBusy(button, false);
    if (!saved) return;
    discardTutorialSession(true);
    showToast("Tutorial complete!");
  }

  function restartTutorial() {
    if (!isTutorialMode()) return;
    const originalFocus = tutorialState.previousFocus;
    discardTutorialSession(false);
    beginTutorialSession(originalFocus);
  }

  function discardTutorialSession(renderRealApp = true) {
    const wasActive = isTutorialMode();
    if (tutorialPositionFrame !== null) {
      window.cancelAnimationFrame(tutorialPositionFrame);
      tutorialPositionFrame = null;
    }
    clearTutorialTarget();
    tutorialState = createEmptyTutorialState();
    document.body.classList.remove("tutorial-active");
    $("#tutorial-mode-banner")?.classList.add("hidden");
    $("#tutorial-panel")?.classList.add("hidden");
    $("#tutorial-spotlight")?.classList.add("hidden");
    closeTutorialDialog($("#tutorial-welcome-dialog"));
    closeTutorialDialog($("#tutorial-exit-dialog"));
    closeTutorialDialog($("#tutorial-price-dialog"));

    if (wasActive && state.household && state.membership) {
      resetPurchaseForm();
      resetRecipeForm();
      $("#grocery-form").reset();
      $("#purchase-month-filter").value = currentMonthValue();
      $("#purchase-category-filter").value = "all";
      $("#recipe-search").value = "";
      $("#grocery-filter").value = "all";
      renderAll();
    }
    if (renderRealApp && wasActive && state.household && state.membership) {
      navigate("dashboard");
      schedulePurchaseSummaryCheck();
      window.setTimeout(() => {
        $("#topbar-refresh")?.focus();
      }, 0);
    }
  }

  function openTutorialDialog(dialog) {
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeTutorialDialog(dialog) {
    if (!dialog) return;
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function clearTutorialTarget() {
    tutorialTargetElement?.classList.remove("tutorial-target");
    tutorialTargetElement = null;
    const spotlight = $("#tutorial-spotlight");
    const panel = $("#tutorial-panel");
    spotlight?.classList.add("hidden");
    if (panel) {
      panel.classList.remove("is-positioned");
      panel.style.removeProperty("top");
      panel.style.removeProperty("left");
    }
  }

  function setTutorialTarget(selector, focusSelector = selector) {
    clearTutorialTarget();
    if (!selector || !isTutorialMode()) {
      $(focusSelector || "#tutorial-panel")?.focus({ preventScroll: true });
      return;
    }
    tutorialTargetElement = $(selector);
    if (!tutorialTargetElement) return;
    tutorialTargetElement.classList.add("tutorial-target");
    tutorialTargetElement.scrollIntoView({ behavior: preferredScrollBehavior(), block: "center", inline: "nearest" });
    window.setTimeout(() => {
      scheduleTutorialPosition();
      $(focusSelector)?.focus({ preventScroll: true });
    }, prefersReducedMotion() ? 0 : 260);
  }

  function scheduleTutorialPosition() {
    if (!isTutorialMode()) return;
    if (tutorialPositionFrame !== null) window.cancelAnimationFrame(tutorialPositionFrame);
    tutorialPositionFrame = window.requestAnimationFrame(() => {
      tutorialPositionFrame = null;
      positionTutorialGuidance();
    });
  }

  function positionTutorialGuidance() {
    const target = tutorialTargetElement;
    const spotlight = $("#tutorial-spotlight");
    const panel = $("#tutorial-panel");
    if (!target || !target.isConnected || !isTutorialMode()) {
      spotlight.classList.add("hidden");
      panel.classList.remove("is-positioned");
      panel.style.removeProperty("top");
      panel.style.removeProperty("left");
      return;
    }

    const rect = target.getBoundingClientRect();
    const padding = 8;
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportWidth = viewport?.width || window.innerWidth;
    const viewportHeight = viewport?.height || window.innerHeight;
    const spotlightTop = Math.max(viewportTop, rect.top - padding);
    const spotlightLeft = Math.max(viewportLeft, rect.left - padding);
    spotlight.style.top = `${spotlightTop}px`;
    spotlight.style.left = `${spotlightLeft}px`;
    spotlight.style.width = `${Math.max(0, Math.min(viewportLeft + viewportWidth - spotlightLeft, rect.width + (padding * 2)))}px`;
    spotlight.style.height = `${Math.max(0, Math.min(viewportTop + viewportHeight - spotlightTop, rect.height + (padding * 2)))}px`;
    spotlight.classList.remove("hidden");

    panel.classList.add("is-positioned");
    const panelRect = panel.getBoundingClientRect();
    const edge = 8;
    const gap = 14;
    const leftEdge = viewportLeft + edge;
    const rightEdge = viewportLeft + viewportWidth - edge;
    const topEdge = viewportTop + edge;
    const bottomEdge = viewportTop + viewportHeight - edge;
    const left = Math.min(Math.max(rect.left, leftEdge), Math.max(leftEdge, rightEdge - panelRect.width));
    let top = rect.bottom + gap;
    if (top + panelRect.height > bottomEdge) top = rect.top - panelRect.height - gap;
    top = Math.min(Math.max(top, topEdge), Math.max(topEdge, bottomEdge - panelRect.height));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function prefersReducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  }

  function preferredScrollBehavior() {
    return prefersReducedMotion() ? "auto" : "smooth";
  }


  let navHideTimer = null;

  function setNavigationCollapsed(collapsed) {
    const nav = $(".bottom-nav");
    const toggle = $("#nav-toggle");
    if (!nav || !toggle) return;
    nav.classList.toggle("nav-collapsed", collapsed);
    toggle.classList.toggle("nav-collapsed", collapsed);
    toggle.textContent = collapsed ? "⌃" : "⌄";
    toggle.setAttribute("aria-label", collapsed ? "Show navigation" : "Hide navigation");
    toggle.setAttribute("aria-expanded", String(!collapsed));
  }

  function scheduleNavigationHide(delay = 3500) {
    window.clearTimeout(navHideTimer);
    navHideTimer = window.setTimeout(() => setNavigationCollapsed(true), delay);
  }

  function setupAutoHideNavigation() {
    const nav = $(".bottom-nav");
    const toggle = $("#nav-toggle");
    if (!nav || !toggle) return;

    toggle.addEventListener("click", () => {
      const isCollapsed = nav.classList.contains("nav-collapsed");
      setNavigationCollapsed(!isCollapsed);
      if (isCollapsed) scheduleNavigationHide(5000);
      else window.clearTimeout(navHideTimer);
    });

    nav.addEventListener("pointerdown", () => window.clearTimeout(navHideTimer));
    nav.addEventListener("pointerup", () => scheduleNavigationHide(2500));

    // Scrolling never opens the navigation. Any meaningful scroll only hides it.
    // The small arrow button is now the only way to open it again.
    let lastY = window.scrollY;
    window.addEventListener("scroll", () => {
      const currentY = window.scrollY;
      if (Math.abs(currentY - lastY) > 8) {
        setNavigationCollapsed(true);
        window.clearTimeout(navHideTimer);
      }
      lastY = currentY;
    }, { passive: true });

    scheduleNavigationHide(4500);
  }

  function normalizeItemName(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  async function copyInviteCode() {
    const code = state.household.invite_code;
    try {
      await navigator.clipboard.writeText(code);
      showToast("Invite code copied.");
    } catch {
      window.prompt("Copy this invite code:", code);
    }
  }

  function navigate(page) {
    if (!page) return;
    if (page === "dashboard") renderDashboardDate();
    $$(".page").forEach((section) => section.classList.toggle("active", section.dataset.page === page));
    $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.target === page));
    const titles = { dashboard: "Dashboard", purchases: "Purchases", recipes: "Recipes", planner: "Meal Planner", grocery: "Grocery List", settings: "Settings" };
    $("#page-title").textContent = titles[page] || "Household Hub";
    $("#topbar-add").classList.toggle("hidden", page !== "dashboard" && page !== "purchases");
    window.scrollTo({ top: 0, behavior: preferredScrollBehavior() });
    scheduleNavigationHide(1800);
  }

  function refreshHouseholdHub() {
    const url = new URL(window.location.href);
    url.searchParams.set("refresh", Date.now().toString());
    window.location.replace(url.toString());
  }

  function showOnly(id) {
    ["setup-screen", "auth-screen", "onboarding-screen", "app-shell"].forEach((screenId) => {
      $("#" + screenId).classList.toggle("hidden", screenId !== id);
    });
  }

  function switchAuthMode(mode) {
    const signin = mode === "signin";
    $("#signin-form").classList.toggle("hidden", !signin);
    $("#signup-form").classList.toggle("hidden", signin);
    $("#show-signin").classList.toggle("active", signin);
    $("#show-signup").classList.toggle("active", !signin);
    setMessage("auth-message", "");
  }

  function selectedCooks() {
    return [
      $("#cook-kate").checked ? "Kate" : null,
      $("#cook-oscar").checked ? "Oscar" : null
    ].filter(Boolean);
  }

  function setDefaultDates() {
    $("#purchase-date").value = todayISO();
    $("#purchase-month-filter").value = currentMonthValue();
  }

  function setBusy(button, busy, busyText = "Working...") {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = busyText;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
      delete button.dataset.originalText;
    }
  }

  function setMessage(id, text, success = false) {
    const element = $("#" + id);
    element.textContent = text;
    element.classList.toggle("success", Boolean(success));
  }

  let toastTimer;
  function showToast(message, isError = false) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3200);
  }

  function throwAndToast(error) {
    showToast(error.message || "Something went wrong.", true);
    throw error;
  }

  function friendlyDuplicateError(error, fallback) {
    return error?.code === "23505" ? fallback : error.message;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);
  }

  function formatDisplayDate(isoDate) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parseISODate(isoDate));
  }

  function formatWeekRange(startISO) {
    const start = parseISODate(startISO);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const startText = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(start);
    const endText = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(end);
    return `${startText} – ${endText}`;
  }

  function currentMonthValue() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function todayISO() {
    return toISODate(new Date());
  }

  function getMondayISO(date) {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
    const day = copy.getDay();
    const offset = day === 0 ? -6 : 1 - day;
    copy.setDate(copy.getDate() + offset);
    return toISODate(copy);
  }

  function toISODate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function parseISODate(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12);
  }

  function sum(values) {
    return values.reduce((total, value) => total + Number(value || 0), 0);
  }

  function shuffle(items) {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  function nullIfEmpty(value) {
    const cleaned = value.trim();
    return cleaned || null;
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHTML(value).replaceAll("`", "&#096;");
  }
})();
