const lucide = require('lucide-react');

const importedIcons = [
    'LayoutDashboard', 'Users', 'Upload', 'Package', 'Box', 'LogOut', 'CheckCircle2', 'AlertCircle',
    'PlusCircle', 'Trash2', 'Save', 'UserPlus', 'Edit2', 'X', 'Filter', 'Tag', 'Receipt', 'ShoppingCart',
    'Search', 'Lock', 'BookOpen', 'Download', 'CalendarDays', 'Plus', 'Minus', 'FileText', 'MapPin', 'DollarSign', 'Printer', 'Map', 'Crosshair', 'ChevronRight', 'Wallet', 'Link', 'Clock', 'Target', 'TrendingUp', 'ChevronDown', 'ChevronUp', 'FileSpreadsheet', 'Settings', 'TableProperties', 'PieChart', 'BarChart3', 'Calculator', 'History', 'TrendingDown', 'Sparkles', 'BrainCircuit', 'Key', 'Github', 'HelpCircle', 'List', 'RefreshCw', 'Weight', 'ArrowRightLeft'
];

let missing = [];
for (let icon of importedIcons) {
    if (!lucide[icon]) {
        missing.push(icon);
    }
}

if (missing.length > 0) {
    console.log("Missing icons:", missing);
} else {
    console.log("All icons exist!");
}
