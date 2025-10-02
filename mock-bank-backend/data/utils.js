export const getCurrentTime = () => new Date().toISOString().split('T')[0];

export const getDaysAgo = (days) => new Date(new Date().setDate(new Date().getDate() - days)).toISOString().split('T')[0];

export const getLastDayOfCurrentMonth = () => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return lastDay.toISOString().split('T')[0];
};
